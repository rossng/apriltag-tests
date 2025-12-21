import './style.css'

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

let images: string[] = [];
let currentImage: string | null = null;
let currentImageData: HTMLImageElement | null = null;
let detections: Detection[] = [];
let selectedDetection: number | null = null;
let hoveredDetection: number | null = null;
let addingDetection: boolean = false;
let editingDetectionIndex: number | null = null;
let newDetectionCorners: (Corner | null)[] = [null, null, null, null];
let originalDetectionCorners: Corner[] | null = null;
let activeCornerIndex: number | null = null;
let zoomLevel: number = 1.0;

const canvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const magnifier = document.getElementById('magnifier') as HTMLDivElement;

async function init(): Promise<void> {
    await loadImages();
    await loadDetectors();
    setupEventListeners();
}

async function loadImages(): Promise<void> {
    const res = await fetch('/api/images');
    images = await res.json() as string[];
    renderImageList();
}

async function loadDetectors(): Promise<void> {
    const res = await fetch('/api/detectors');
    const detectors = await res.json() as string[];
    const select = document.getElementById('importDetector') as HTMLSelectElement;
    select.innerHTML = detectors.map(d => `<option>${d}</option>`).join('');
}

function renderImageList(): void {
    const list = document.getElementById('imageList')!;
    list.innerHTML = images.map(img =>
        `<div class="image-item ${img === currentImage ? 'active' : ''}" data-image="${img}">
            ${img}
        </div>`
    ).join('');

    list.querySelectorAll('.image-item').forEach(item => {
        item.addEventListener('click', () => loadImage((item as HTMLElement).dataset.image!));
    });
}

async function loadImage(filename: string): Promise<void> {
    currentImage = filename;

    const img = new Image();
    img.onload = () => {
        currentImageData = img;
        canvas.width = img.width;
        canvas.height = img.height;
        render();
    };
    img.src = `/api/image/${filename}`;

    const res = await fetch(`/api/ground-truth/${filename}`);
    const data = await res.json() as DetectionResult;
    detections = data.detections || [];
    selectedDetection = null;

    document.getElementById('imageInfo')!.textContent = filename;
    renderImageList();
    renderDetectionList();
}

function renderDetectionList(): void {
    document.getElementById('detectionCount')!.textContent = detections.length.toString();
    const list = document.getElementById('detectionList')!;

    list.innerHTML = detections.map((det, idx) =>
        `<div class="detection-item ${idx === selectedDetection ? 'selected' : ''}" data-index="${idx}">
            <div class="detection-header">
                <div>
                    <div class="detection-title">ID ${det.tag_id}</div>
                    <div class="detection-family">${det.tag_family}</div>
                </div>
                <div class="detection-actions">
                    <button class="edit-btn" data-index="${idx}">Edit</button>
                    <button class="delete-btn" data-index="${idx}">Delete</button>
                </div>
            </div>
        </div>`
    ).join('');

    list.querySelectorAll('.detection-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target.classList.contains('delete-btn') && !target.classList.contains('edit-btn')) {
                selectedDetection = parseInt((item as HTMLElement).dataset.index!);
                renderDetectionList();
                render();
            }
        });

        item.addEventListener('mouseenter', () => {
            hoveredDetection = parseInt((item as HTMLElement).dataset.index!);
            render();
        });

        item.addEventListener('mouseleave', () => {
            hoveredDetection = null;
            render();
        });
    });

    list.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt((btn as HTMLElement).dataset.index!);
            startEditingDetection(idx);
        });
    });

    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            detections.splice(parseInt((btn as HTMLElement).dataset.index!), 1);
            selectedDetection = null;
            renderDetectionList();
            render();
        });
    });
}

function updateCornerButtons(): void {
    const buttons = document.querySelectorAll('.corner-btn');
    const hint = document.getElementById('cornerHint');

    buttons.forEach((btn, idx) => {
        btn.classList.remove('active', 'set');
        if (newDetectionCorners[idx] !== null) {
            btn.classList.add('set');
        }
        if (idx === activeCornerIndex) {
            btn.classList.add('active');
        }
    });

    if (hint) {
        if (activeCornerIndex === null) {
            hint.textContent = 'Click a corner button to start';
        } else {
            const cornerNames = ['Bottom-Left', 'Bottom-Right', 'Top-Right', 'Top-Left'];
            hint.textContent = `Click on image to set ${cornerNames[activeCornerIndex]}`;
        }
    }
}

function startEditingDetection(idx: number): void {
    const detection = detections[idx];
    editingDetectionIndex = idx;
    addingDetection = true;

    originalDetectionCorners = [...detection.corners];
    newDetectionCorners = [...detection.corners];
    activeCornerIndex = null;

    const panel = document.getElementById('addPanel')!;
    panel.style.display = 'block';

    const title = panel.querySelector('h3')!;
    title.textContent = `Editing Detection (ID ${detection.tag_id})`;

    (document.getElementById('newFamily') as HTMLSelectElement).value = detection.tag_family;
    (document.getElementById('newTagId') as HTMLInputElement).value = detection.tag_id.toString();

    const saveBtn = document.getElementById('saveEdit')!;
    saveBtn.style.display = 'block';

    updateCornerButtons();

    selectedDetection = idx;
    renderDetectionList();
    render();
}

function updateZoomDisplay(): void {
    canvas.style.transform = `scale(${zoomLevel})`;
    canvas.style.transformOrigin = 'top left';
    const zoomDisplay = document.getElementById('zoomLevel');
    if (zoomDisplay) {
        zoomDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
    }
}

function render(): void {
    if (!currentImageData) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentImageData, 0, 0);

    detections.forEach((det, idx) => {
        const isSelected = idx === selectedDetection;
        const isHovered = idx === hoveredDetection;
        drawDetection(det, isSelected, isHovered);
    });

    if (addingDetection) {
        const cornerColors = ['#e74c3c', '#f39c12', '#9b59b6', '#3498db'];
        const placedCorners = newDetectionCorners.filter((c): c is Corner => c !== null);

        if (placedCorners.length > 0) {
            placedCorners.forEach((corner, idx) => {
                ctx.fillStyle = cornerColors[idx];
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(corner.x, corner.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });

            if (placedCorners.length > 1) {
                ctx.strokeStyle = '#3498db';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(placedCorners[0].x, placedCorners[0].y);
                for (let i = 1; i < placedCorners.length; i++) {
                    ctx.lineTo(placedCorners[i].x, placedCorners[i].y);
                }
                if (placedCorners.length === 4) {
                    ctx.closePath();
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        if (activeCornerIndex !== null && newDetectionCorners[activeCornerIndex] !== null) {
            const corner = newDetectionCorners[activeCornerIndex]!;
            ctx.strokeStyle = cornerColors[activeCornerIndex];
            ctx.fillStyle = cornerColors[activeCornerIndex] + '40';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(corner.x, corner.y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }
}

function drawDetection(det: Detection, isSelected: boolean, isHovered: boolean): void {
    const corners = det.corners;

    let fillColor = 'rgba(46, 204, 113, 0.2)';
    let strokeColor = '#27ae60';
    let lineWidth = 2;

    if (isSelected) {
        fillColor = 'rgba(52, 152, 219, 0.3)';
        strokeColor = '#3498db';
        lineWidth = 3;
    } else if (isHovered) {
        fillColor = 'rgba(52, 152, 219, 0.15)';
        strokeColor = '#5dade2';
        lineWidth = 2;
    }

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    const cornerLabels = ['BL', 'BR', 'TR', 'TL'];
    const cornerColors = ['#e74c3c', '#f39c12', '#9b59b6', '#3498db'];

    corners.forEach((corner, idx) => {
        ctx.fillStyle = isSelected ? cornerColors[idx] : '#27ae60';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeText(cornerLabels[idx], corner.x, corner.y);
            ctx.fillText(cornerLabels[idx], corner.x, corner.y);
        }
    });

    const centerX = corners.reduce((sum, c) => sum + c.x, 0) / 4;
    const centerY = corners.reduce((sum, c) => sum + c.y, 0) / 4;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(det.tag_id.toString(), centerX, centerY);
    ctx.fillText(det.tag_id.toString(), centerX, centerY);
}

async function saveGroundTruth(): Promise<void> {
    if (!currentImage) return;

    const data: DetectionResult = {
        image: currentImage,
        detections: detections
    };

    await fetch(`/api/ground-truth/${currentImage}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    alert('Ground truth saved!');
}

function setupEventListeners(): void {
    document.getElementById('saveButton')!.addEventListener('click', saveGroundTruth);

    document.getElementById('zoomIn')!.addEventListener('click', () => {
        zoomLevel = Math.min(zoomLevel * 1.2, 5.0);
        updateZoomDisplay();
    });

    document.getElementById('zoomOut')!.addEventListener('click', () => {
        zoomLevel = Math.max(zoomLevel / 1.2, 0.1);
        updateZoomDisplay();
    });

    document.getElementById('zoomReset')!.addEventListener('click', () => {
        zoomLevel = 1.0;
        updateZoomDisplay();
    });

    document.getElementById('addDetection')!.addEventListener('click', () => {
        const panel = document.getElementById('addPanel')!;
        panel.style.display = 'block';
        addingDetection = true;
        editingDetectionIndex = null;
        newDetectionCorners = [null, null, null, null];
        activeCornerIndex = 0;

        const title = panel.querySelector('h3')!;
        title.textContent = 'Adding Detection';

        (document.getElementById('newFamily') as HTMLSelectElement).value = 'tag36h11';
        (document.getElementById('newTagId') as HTMLInputElement).value = '0';

        const saveBtn = document.getElementById('saveEdit')!;
        saveBtn.style.display = 'none';

        updateCornerButtons();
    });

    document.querySelectorAll('.corner-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!addingDetection) return;
            activeCornerIndex = parseInt((btn as HTMLElement).dataset.corner!);
            updateCornerButtons();
            render();
        });
    });

    document.getElementById('saveEdit')!.addEventListener('click', () => {
        if (editingDetectionIndex === null) return;

        const family = (document.getElementById('newFamily') as HTMLSelectElement).value;
        const tagId = parseInt((document.getElementById('newTagId') as HTMLInputElement).value);

        detections[editingDetectionIndex].tag_family = family;
        detections[editingDetectionIndex].tag_id = tagId;

        originalDetectionCorners = null;

        addingDetection = false;
        editingDetectionIndex = null;
        newDetectionCorners = [null, null, null, null];
        activeCornerIndex = null;
        document.getElementById('addPanel')!.style.display = 'none';
        document.getElementById('saveEdit')!.style.display = 'none';
        renderDetectionList();
        render();
    });

    document.getElementById('cancelAdd')!.addEventListener('click', () => {
        if (editingDetectionIndex !== null && originalDetectionCorners !== null) {
            detections[editingDetectionIndex].corners = [...originalDetectionCorners];
        }

        document.getElementById('addPanel')!.style.display = 'none';
        addingDetection = false;
        editingDetectionIndex = null;
        newDetectionCorners = [null, null, null, null];
        originalDetectionCorners = null;
        activeCornerIndex = null;
        document.getElementById('saveEdit')!.style.display = 'none';
        render();
    });

    document.getElementById('importDetections')!.addEventListener('click', () => {
        document.getElementById('importModal')!.classList.add('active');
    });

    document.getElementById('cancelImport')!.addEventListener('click', () => {
        document.getElementById('importModal')!.classList.remove('active');
    });

    document.getElementById('doImport')!.addEventListener('click', importDetections);

    canvas.addEventListener('click', (e) => {
        if (!addingDetection || activeCornerIndex === null) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        newDetectionCorners[activeCornerIndex] = { x, y };

        if (editingDetectionIndex !== null) {
            detections[editingDetectionIndex].corners = newDetectionCorners.filter((c): c is Corner => c !== null);
        }

        if (editingDetectionIndex === null) {
            if (activeCornerIndex < 3) {
                activeCornerIndex++;
            } else {
                const family = (document.getElementById('newFamily') as HTMLSelectElement).value;
                const tagId = parseInt((document.getElementById('newTagId') as HTMLInputElement).value);

                detections.push({
                    tag_id: tagId,
                    tag_family: family,
                    corners: newDetectionCorners.filter((c): c is Corner => c !== null)
                });

                addingDetection = false;
                editingDetectionIndex = null;
                newDetectionCorners = [null, null, null, null];
                activeCornerIndex = null;
                document.getElementById('addPanel')!.style.display = 'none';
                renderDetectionList();
            }
        }

        updateCornerButtons();
        render();
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!currentImageData) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        magnifier.style.display = 'block';

        const canvasArea = canvas.parentElement!.parentElement!.getBoundingClientRect();
        const canvasX = e.clientX - canvasArea.left;
        const canvasY = e.clientY - canvasArea.top;
        const isBottomRight = canvasX > canvasArea.width * 0.7 && canvasY > canvasArea.height * 0.7;

        if (isBottomRight) {
            magnifier.style.bottom = '2rem';
            magnifier.style.right = 'auto';
            magnifier.style.top = 'auto';
            magnifier.style.left = `${canvasArea.left + 16}px`;
        } else {
            magnifier.style.bottom = '2rem';
            magnifier.style.right = '2rem';
            magnifier.style.top = 'auto';
            magnifier.style.left = 'auto';
        }

        const mag = 4;
        const size = 200;
        magnifier.innerHTML = '';
        const magCanvas = document.createElement('canvas');
        magCanvas.width = size;
        magCanvas.height = size;
        magCanvas.style.width = '100%';
        magCanvas.style.height = '100%';
        magnifier.appendChild(magCanvas);

        const magCtx = magCanvas.getContext('2d')!;
        magCtx.imageSmoothingEnabled = false;

        const sourceSize = size / mag;
        const sourceX = Math.max(0, Math.min(x - sourceSize / 2, currentImageData.width - sourceSize));
        const sourceY = Math.max(0, Math.min(y - sourceSize / 2, currentImageData.height - sourceSize));

        magCtx.drawImage(
            currentImageData,
            sourceX, sourceY, sourceSize, sourceSize,
            0, 0, size, size
        );

        magCtx.strokeStyle = '#3498db';
        magCtx.lineWidth = 2;
        magCtx.beginPath();
        magCtx.moveTo(size / 2, 0);
        magCtx.lineTo(size / 2, size);
        magCtx.moveTo(0, size / 2);
        magCtx.lineTo(size, size / 2);
        magCtx.stroke();

        magCtx.strokeStyle = '#e74c3c';
        magCtx.lineWidth = 1;
        magCtx.beginPath();
        magCtx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
        magCtx.stroke();
    });

    canvas.addEventListener('mouseleave', () => {
        magnifier.style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));

            if (addingDetection) {
                if (editingDetectionIndex !== null && originalDetectionCorners !== null) {
                    detections[editingDetectionIndex].corners = [...originalDetectionCorners];
                }

                document.getElementById('addPanel')!.style.display = 'none';
                addingDetection = false;
                editingDetectionIndex = null;
                newDetectionCorners = [null, null, null, null];
                originalDetectionCorners = null;
                activeCornerIndex = null;
                document.getElementById('saveEdit')!.style.display = 'none';
                render();
            }
        }
    });
}

async function importDetections(): Promise<void> {
    if (!currentImage) return;

    const detector = (document.getElementById('importDetector') as HTMLSelectElement).value;
    const family = (document.getElementById('importFamily') as HTMLSelectElement).value;

    try {
        const res = await fetch(`/api/results/${detector}/${currentImage}`);
        const data = await res.json() as DetectionResult;

        let imported = data.detections || [];
        if (family) {
            imported = imported.filter(d => d.tag_family === family);
        }

        detections = [...detections, ...imported];
        renderDetectionList();
        render();

        document.getElementById('importModal')!.classList.remove('active');
    } catch (err) {
        alert('Failed to import: ' + (err as Error).message);
    }
}

init();
