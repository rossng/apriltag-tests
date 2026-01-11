import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import type {
  Detection,
  DetectionFile,
  Manifest,
  ImageResult,
  Summary,
  Timings,
  SerializableImageResult,
  SerializableSummary,
  SerializableFamilyTiming,
} from './types';
import { DetectionKey } from './types';

function loadDetections(jsonPath: string): DetectionFile | null {
  if (!existsSync(jsonPath)) {
    return null;
  }
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as DetectionFile;
  return data;
}

function toDetectionKeys(detections: Detection[]): DetectionKey[] {
  return detections.map(d => new DetectionKey(d.tag_id, d.tag_family));
}

function loadManifest(manifestPath: string): Manifest | null {
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
    return data;
  } catch {
    return null;
  }
}

export function discoverDetectors(resultsDir: string): string[] {
  if (!existsSync(resultsDir)) {
    return [];
  }
  const entries = readdirSync(resultsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();
}

export function collectResults(
  groundTruthDir: string,
  resultsDir: string,
  detectorNames: string[]
): Map<string, ImageResult> {
  const results = new Map<string, ImageResult>();

  if (!existsSync(groundTruthDir)) {
    console.error(`Ground truth directory not found: ${groundTruthDir}`);
    return results;
  }

  const gtFiles = readdirSync(groundTruthDir)
    .filter(f => f.endsWith('.json'))
    .map(f => join(groundTruthDir, f));

  for (const gtFile of gtFiles) {
    const gtData = loadDetections(gtFile);
    if (!gtData) continue;

    const imageName = gtData.image || basename(gtFile, '.json');
    const result: ImageResult = {
      imageName,
      groundTruth: toDetectionKeys(gtData.detections),
      detectorResults: new Map(),
      missed: new Map(),
      falsePositives: new Map(),
      timings: new Map()
    };

    for (const detectorName of detectorNames) {
      const detectorDir = join(resultsDir, detectorName);
      const detectorFile = join(detectorDir, basename(gtFile));

      if (existsSync(detectorFile)) {
        const detData = loadDetections(detectorFile);
        if (detData) {
          result.detectorResults.set(detectorName, toDetectionKeys(detData.detections));
          result.timings.set(detectorName, detData.timings || null);
        } else {
          result.detectorResults.set(detectorName, []);
          result.timings.set(detectorName, null);
        }
      } else {
        result.detectorResults.set(detectorName, []);
        result.timings.set(detectorName, null);
      }
    }

    const gtSet = new Set(result.groundTruth.map(d => d.toString()));

    for (const detectorName of detectorNames) {
      const detected = result.detectorResults.get(detectorName) || [];
      const detectedSet = new Set(detected.map(d => d.toString()));

      const missed = new Set<DetectionKey>();
      const falsePos = new Set<DetectionKey>();

      for (const gt of result.groundTruth) {
        if (!detectedSet.has(gt.toString())) {
          missed.add(gt);
        }
      }

      for (const det of detected) {
        if (!gtSet.has(det.toString())) {
          falsePos.add(det);
        }
      }

      result.missed.set(detectorName, missed);
      result.falsePositives.set(detectorName, falsePos);
    }

    results.set(imageName, result);
  }

  return results;
}

export function computeSummary(
  results: Map<string, ImageResult>,
  detectorNames: string[],
  resultsDir: string
): Map<string, Summary> {
  const summaries = new Map<string, Summary>();

  for (const detectorName of detectorNames) {
    let totalGt = 0;
    let totalDetected = 0;
    let totalMissed = 0;
    let totalFalsePositives = 0;

    const missedByFamily = new Map<string, number>();
    const fpByFamily = new Map<string, number>();

    let totalImageLoadMs = 0;
    let totalDetectionMs = 0;
    let imageCount = 0;
    const familyTimingAgg = new Map<string, { totalInit: number; totalDetect: number; count: number }>();

    for (const result of results.values()) {
      totalGt += result.groundTruth.length;
      totalDetected += (result.detectorResults.get(detectorName) || []).length;

      const missed = result.missed.get(detectorName) || new Set();
      const fps = result.falsePositives.get(detectorName) || new Set();

      totalMissed += missed.size;
      totalFalsePositives += fps.size;

      for (const det of missed) {
        missedByFamily.set(det.tagFamily, (missedByFamily.get(det.tagFamily) || 0) + 1);
      }

      for (const det of fps) {
        fpByFamily.set(det.tagFamily, (fpByFamily.get(det.tagFamily) || 0) + 1);
      }

      const timing = result.timings.get(detectorName);
      if (timing) {
        totalImageLoadMs += timing.image_load_ms;
        totalDetectionMs += timing.total_detection_ms;
        imageCount++;

        for (const ft of timing.family_timings) {
          const existing = familyTimingAgg.get(ft.family) || { totalInit: 0, totalDetect: 0, count: 0 };
          existing.totalInit += ft.initialization_ms;
          existing.totalDetect += ft.detection_ms;
          existing.count++;
          familyTimingAgg.set(ft.family, existing);
        }
      }
    }

    const truePositives = totalGt - totalMissed;
    const precision = totalDetected > 0 ? truePositives / totalDetected : 0;
    const recall = totalGt > 0 ? truePositives / totalGt : 0;
    const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    const manifestPath = join(resultsDir, detectorName, 'manifest.json');
    const manifest = loadManifest(manifestPath);
    const supportedFamilies = manifest?.supported_families || [];

    const familyTimings = new Map<string, { avgInit: number; avgDetect: number; count: number }>();
    for (const [family, agg] of familyTimingAgg) {
      familyTimings.set(family, {
        avgInit: agg.count > 0 ? agg.totalInit / agg.count : 0,
        avgDetect: agg.count > 0 ? agg.totalDetect / agg.count : 0,
        count: agg.count
      });
    }

    summaries.set(detectorName, {
      totalGroundTruth: totalGt,
      totalDetected,
      truePositives,
      missed: totalMissed,
      falsePositives: totalFalsePositives,
      precision,
      recall,
      f1Score,
      missedByFamily,
      fpByFamily,
      supportedFamilies,
      timing: {
        avgImageLoadMs: imageCount > 0 ? totalImageLoadMs / imageCount : 0,
        avgTotalDetectionMs: imageCount > 0 ? totalDetectionMs / imageCount : 0,
        totalImageLoadMs,
        totalDetectionMs,
        imageCount,
        familyTimings
      }
    });
  }

  return summaries;
}

export function loadAllData(
  groundTruthDir: string,
  resultsDir: string,
  detectorNames: string[]
): {
  results: Map<string, ImageResult>;
  summaries: Map<string, Summary>;
  rawDetections: Map<string, { groundTruth: Detection[]; detectors: Map<string, Detection[]> }>;
} {
  const results = collectResults(groundTruthDir, resultsDir, detectorNames);
  const summaries = computeSummary(results, detectorNames, resultsDir);

  const rawDetections = new Map<string, { groundTruth: Detection[]; detectors: Map<string, Detection[]> }>();

  const gtFiles = existsSync(groundTruthDir)
    ? readdirSync(groundTruthDir).filter(f => f.endsWith('.json'))
    : [];

  for (const gtFileName of gtFiles) {
    const gtFile = join(groundTruthDir, gtFileName);
    const gtData = loadDetections(gtFile);
    if (!gtData) continue;

    const imageName = gtData.image || basename(gtFileName, '.json');
    const detectors = new Map<string, Detection[]>();

    for (const detectorName of detectorNames) {
      const detectorFile = join(resultsDir, detectorName, gtFileName);
      const detData = loadDetections(detectorFile);
      detectors.set(detectorName, detData?.detections || []);
    }

    rawDetections.set(imageName, {
      groundTruth: gtData.detections,
      detectors
    });
  }

  return { results, summaries, rawDetections };
}

export function toSerializableResult(
  result: ImageResult,
  rawDetections: { groundTruth: Detection[]; detectors: Map<string, Detection[]> }
): SerializableImageResult {
  const detectorResults: Record<string, Detection[]> = {};
  const missed: Record<string, string[]> = {};
  const falsePositives: Record<string, string[]> = {};
  const stats: Record<string, { detected: number; missed: number; falsePositives: number }> = {};
  const timings: Record<string, Timings | null> = {};

  for (const [name, dets] of rawDetections.detectors) {
    detectorResults[name] = dets;
  }

  for (const [name, set] of result.missed) {
    missed[name] = Array.from(set).map(d => d.toString());
  }

  for (const [name, set] of result.falsePositives) {
    falsePositives[name] = Array.from(set).map(d => d.toString());
  }

  for (const [name, dets] of result.detectorResults) {
    const missedSet = result.missed.get(name) || new Set();
    const fpSet = result.falsePositives.get(name) || new Set();
    stats[name] = {
      detected: dets.length,
      missed: missedSet.size,
      falsePositives: fpSet.size
    };
  }

  for (const [name, timing] of result.timings) {
    timings[name] = timing;
  }

  return {
    imageName: result.imageName,
    imagePath: `data/${result.imageName}`,
    groundTruth: rawDetections.groundTruth,
    detectorResults,
    missed,
    falsePositives,
    stats,
    timings
  };
}

export function toSerializableSummary(summary: Summary): SerializableSummary {
  const familyTimings: SerializableFamilyTiming[] = [];
  for (const [family, timing] of summary.timing.familyTimings) {
    familyTimings.push({ family, ...timing });
  }

  const missedByFamily: Record<string, number> = {};
  for (const [family, count] of summary.missedByFamily) {
    missedByFamily[family] = count;
  }

  const fpByFamily: Record<string, number> = {};
  for (const [family, count] of summary.fpByFamily) {
    fpByFamily[family] = count;
  }

  return {
    totalGroundTruth: summary.totalGroundTruth,
    totalDetected: summary.totalDetected,
    truePositives: summary.truePositives,
    missed: summary.missed,
    falsePositives: summary.falsePositives,
    precision: summary.precision,
    recall: summary.recall,
    f1Score: summary.f1Score,
    missedByFamily,
    fpByFamily,
    supportedFamilies: summary.supportedFamilies,
    timing: {
      avgImageLoadMs: summary.timing.avgImageLoadMs,
      avgTotalDetectionMs: summary.timing.avgTotalDetectionMs,
      totalImageLoadMs: summary.timing.totalImageLoadMs,
      totalDetectionMs: summary.timing.totalDetectionMs,
      imageCount: summary.timing.imageCount,
      familyTimings
    }
  };
}
