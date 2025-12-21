import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Find project root by locating git repository
function findProjectRoot(): string {
    try {
        const gitRoot = execSync('git rev-parse --show-toplevel', {
            encoding: 'utf8',
            cwd: process.cwd()
        }).trim();
        return gitRoot;
    } catch {
        return process.cwd();
    }
}

const PROJECT_ROOT = findProjectRoot();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const GROUND_TRUTH_DIR = path.join(PROJECT_ROOT, 'ground-truth');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'results');
const PUBLIC_DIR = path.join(__dirname, 'public');

interface Corner {
    x: number;
    y: number;
}

interface Detection {
    tag_id: number;
    tag_family: string;
    corners: Corner[];
}

interface DetectionResult {
    image: string;
    detections: Detection[];
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'text/javascript');
        }
    }
}));

if (!fs.existsSync(GROUND_TRUTH_DIR)) {
    fs.mkdirSync(GROUND_TRUTH_DIR, { recursive: true });
}

app.get('/api/images', (_req: Request, res: Response) => {
    try {
        const files = fs.readdirSync(DATA_DIR)
            .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
            .sort();
        res.json(files);
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/image/:filename', (req: Request, res: Response) => {
    const imagePath = path.join(DATA_DIR, req.params.filename);
    if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    res.sendFile(imagePath);
});

app.get('/api/ground-truth/:filename', (req: Request, res: Response) => {
    const basename = path.parse(req.params.filename).name;
    const gtPath = path.join(GROUND_TRUTH_DIR, `${basename}.json`);

    if (!fs.existsSync(gtPath)) {
        return res.json({
            image: req.params.filename,
            detections: []
        });
    }

    try {
        const data = fs.readFileSync(gtPath, 'utf8');
        res.json(JSON.parse(data) as DetectionResult);
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ground-truth/:filename', (req: Request, res: Response) => {
    const basename = path.parse(req.params.filename).name;
    const gtPath = path.join(GROUND_TRUTH_DIR, `${basename}.json`);

    try {
        fs.writeFileSync(gtPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/detectors', (_req: Request, res: Response) => {
    try {
        if (!fs.existsSync(RESULTS_DIR)) {
            return res.json([]);
        }
        const detectors = fs.readdirSync(RESULTS_DIR)
            .filter(f => fs.statSync(path.join(RESULTS_DIR, f)).isDirectory())
            .sort();
        res.json(detectors);
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/results/:detector/:filename', (req: Request, res: Response) => {
    const basename = path.parse(req.params.filename).name;
    const resultPath = path.join(RESULTS_DIR, req.params.detector, `${basename}.json`);

    if (!fs.existsSync(resultPath)) {
        return res.status(404).json({ error: 'Results not found' });
    }

    try {
        const data = fs.readFileSync(resultPath, 'utf8');
        res.json(JSON.parse(data) as DetectionResult);
    } catch (err) {
        const error = err as Error;
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Ground truth editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
});
