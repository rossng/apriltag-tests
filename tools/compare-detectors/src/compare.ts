#!/usr/bin/env node
/**
 * Compare detector results against ground truth and generate HTML report.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

interface Corner {
  x: number;
  y: number;
}

interface Detection {
  tag_id: number;
  tag_family: string;
  corners: Corner[];
}

interface FamilyTiming {
  family: string;
  initialization_ms: number;
  detection_ms: number;
}

interface Timings {
  image_load_ms: number;
  total_detection_ms: number;
  family_timings: FamilyTiming[];
}

interface DetectionFile {
  image: string;
  detections: Detection[];
  timings?: Timings;
}

interface Manifest {
  supported_families: string[];
}

class DetectionKey {
  constructor(
    public readonly tagId: number,
    public readonly tagFamily: string
  ) {}

  equals(other: DetectionKey): boolean {
    return this.tagId === other.tagId && this.tagFamily === other.tagFamily;
  }

  toString(): string {
    return `${this.tagFamily}:${this.tagId}`;
  }
}

interface ImageResult {
  imageName: string;
  groundTruth: DetectionKey[];
  detectorResults: Map<string, DetectionKey[]>;
  missed: Map<string, Set<DetectionKey>>;
  falsePositives: Map<string, Set<DetectionKey>>;
  timings: Map<string, Timings | null>;
}

interface TimingSummary {
  avgImageLoadMs: number;
  avgTotalDetectionMs: number;
  totalImageLoadMs: number;
  totalDetectionMs: number;
  imageCount: number;
  familyTimings: Map<string, { avgInit: number; avgDetect: number; count: number }>;
}

interface Summary {
  totalGroundTruth: number;
  totalDetected: number;
  truePositives: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  missedByFamily: Map<string, number>;
  fpByFamily: Map<string, number>;
  supportedFamilies: string[];
  timing: TimingSummary;
}

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
  } catch (e) {
    return null;
  }
}

function collectResults(
  groundTruthDir: string,
  resultsDir: string,
  detectorNames: string[]
): Map<string, ImageResult> {
  const results = new Map<string, ImageResult>();

  if (!existsSync(groundTruthDir)) {
    throw new Error(`Ground truth directory not found: ${groundTruthDir}`);
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

    // Load detector results
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

    // Compute comparison
    const gtSet = new Set(result.groundTruth.map(d => d.toString()));

    for (const detectorName of detectorNames) {
      const detected = result.detectorResults.get(detectorName) || [];
      const detectedSet = new Set(detected.map(d => d.toString()));

      const missed = new Set<DetectionKey>();
      const falsePos = new Set<DetectionKey>();

      // Find missed detections
      for (const gt of result.groundTruth) {
        if (!detectedSet.has(gt.toString())) {
          missed.add(gt);
        }
      }

      // Find false positives
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

function computeSummary(
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

    // Timing aggregation
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

      // Aggregate timing
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

    // Load manifest to get supported families
    const manifestPath = join(resultsDir, detectorName, 'manifest.json');
    const manifest = loadManifest(manifestPath);
    const supportedFamilies = manifest?.supported_families || [];

    // Compute timing averages
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


function generateHtmlReport(
  results: Map<string, ImageResult>,
  summaries: Map<string, Summary>,
  detectorNames: string[],
  outputPath: string,
  dataDir: string,
  groundTruthDir: string,
  resultsDir: string
): void {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AprilTag Detector Comparison Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1, h2, h3 {
            color: #333;
        }
        h1 {
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }
        h2 {
            margin-top: 30px;
            border-bottom: 2px solid #2196F3;
            padding-bottom: 8px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .detector-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .detector-card h3 {
            margin-top: 0;
            color: #2196F3;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .metric:last-child {
            border-bottom: none;
        }
        .metric-label {
            font-weight: 500;
            color: #666;
        }
        .metric-value {
            font-weight: 600;
            color: #333;
        }
        .good { color: #4CAF50; }
        .warning { color: #FF9800; }
        .error { color: #f44336; }

        .image-section {
            background: white;
            margin: 20px 0;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .image-section h3 {
            margin-top: 0;
            color: #333;
        }
        .detector-results {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .detector-result {
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            background: #fafafa;
        }
        .detector-result h4 {
            margin: 0 0 10px 0;
            color: #2196F3;
            font-size: 16px;
        }
        .tag-list {
            margin: 8px 0;
        }
        .tag-list-label {
            font-weight: 600;
            color: #666;
            font-size: 14px;
        }
        .tag {
            display: inline-block;
            margin: 4px 4px 4px 0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 13px;
            font-family: monospace;
        }
        .tag-gt {
            background: #E3F2FD;
            color: #1976D2;
        }
        .tag-detected {
            background: #E8F5E9;
            color: #388E3C;
        }
        .tag-missed {
            background: #FFEBEE;
            color: #D32F2F;
        }
        .tag-fp {
            background: #FFF3E0;
            color: #F57C00;
        }
        .stats-row {
            display: flex;
            gap: 15px;
            margin-top: 10px;
            font-size: 13px;
            flex-wrap: wrap;
        }
        .stat {
            padding: 4px 8px;
            border-radius: 4px;
            background: #f5f5f5;
        }
        .percentage {
            font-size: 24px;
            font-weight: bold;
        }
        .family-breakdown {
            margin-top: 10px;
            font-size: 14px;
        }
        .family-item {
            padding: 4px 0;
            color: #666;
        }
        .image-viewer {
            margin: 20px 0;
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .canvas-container {
            display: flex;
            justify-content: center;
        }
        .canvas-container canvas {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .viewer-controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }
        .viewer-button {
            padding: 10px 20px;
            border: 2px solid #ddd;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .viewer-button:hover {
            border-color: #2196F3;
            background: #E3F2FD;
        }
        .viewer-button.active {
            border-color: #2196F3;
            background: #2196F3;
            color: white;
        }
        .no-visualization {
            text-align: center;
            padding: 40px;
            color: #999;
            font-style: italic;
        }
        .timing-section {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px dashed #ddd;
        }
        .timing-section h4 {
            margin: 0 0 10px 0;
            color: #9C27B0;
            font-size: 14px;
        }
        .timing-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
        }
        .timing-item {
            background: #F3E5F5;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
        }
        .timing-item .timing-label {
            color: #7B1FA2;
            font-weight: 500;
            display: block;
            font-size: 11px;
            text-transform: uppercase;
        }
        .timing-item .timing-value {
            color: #4A148C;
            font-weight: 600;
            font-size: 16px;
        }
        .timing-family-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 13px;
        }
        .timing-family-table th,
        .timing-family-table td {
            padding: 6px 10px;
            text-align: left;
            border-bottom: 1px solid #E1BEE7;
        }
        .timing-family-table th {
            background: #E1BEE7;
            color: #4A148C;
            font-weight: 600;
        }
        .timing-family-table td {
            background: #F3E5F5;
        }
        .timing-bar {
            display: flex;
            height: 20px;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 8px;
        }
        .timing-bar-segment {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: white;
            font-weight: 600;
        }
        .timing-bar-load {
            background: #7B1FA2;
        }
        .timing-bar-detect {
            background: #AB47BC;
        }
        .image-timing {
            margin-top: 10px;
            padding: 8px;
            background: #F3E5F5;
            border-radius: 4px;
            font-size: 12px;
        }
        .image-timing-row {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
        }
        .image-timing-label {
            color: #7B1FA2;
        }
        .image-timing-value {
            color: #4A148C;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <h1>AprilTag Detector Comparison Report</h1>
    <p>Comparison of detector performance against ground truth annotations.</p>
`;

  // Summary Section
  html += '<h2>Summary Statistics</h2>\n';
  html += '<div class="summary-grid">\n';

  for (const detectorName of detectorNames) {
    const stats = summaries.get(detectorName)!;
    const f1 = stats.f1Score;
    const f1Class = f1 >= 0.9 ? 'good' : (f1 >= 0.7 ? 'warning' : 'error');

    html += `<div class="detector-card">\n`;
    html += `<h3>${detectorName}</h3>\n`;

    // Supported families
    if (stats.supportedFamilies.length > 0) {
      html += '<div class="family-breakdown"><strong>Supported Families:</strong>\n';
      html += '<div class="family-item">';
      html += stats.supportedFamilies.join(', ');
      html += '</div>\n';
      html += '</div>\n';
    }

    html += `<div class="metric"><span class="metric-label">F1 Score</span>`;
    html += `<span class="metric-value percentage ${f1Class}">${(f1 * 100).toFixed(1)}%</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">Precision</span>`;
    html += `<span class="metric-value">${(stats.precision * 100).toFixed(1)}%</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">Recall</span>`;
    html += `<span class="metric-value">${(stats.recall * 100).toFixed(1)}%</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">Ground Truth Tags</span>`;
    html += `<span class="metric-value">${stats.totalGroundTruth}</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">True Positives</span>`;
    html += `<span class="metric-value good">${stats.truePositives}</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">Missed Detections</span>`;
    html += `<span class="metric-value error">${stats.missed}</span></div>\n`;
    html += `<div class="metric"><span class="metric-label">False Positives</span>`;
    html += `<span class="metric-value warning">${stats.falsePositives}</span></div>\n`;

    // Family breakdown for missed
    if (stats.missedByFamily.size > 0) {
      html += '<div class="family-breakdown"><strong>Missed by Family:</strong>\n';
      for (const [family, count] of Array.from(stats.missedByFamily.entries()).sort()) {
        html += `<div class="family-item">${family}: ${count}</div>\n`;
      }
      html += '</div>\n';
    }

    // Family breakdown for false positives
    if (stats.fpByFamily.size > 0) {
      html += '<div class="family-breakdown"><strong>False Positives by Family:</strong>\n';
      for (const [family, count] of Array.from(stats.fpByFamily.entries()).sort()) {
        html += `<div class="family-item">${family}: ${count}</div>\n`;
      }
      html += '</div>\n';
    }

    // Timing section
    if (stats.timing.imageCount > 0) {
      html += '<div class="timing-section">\n';
      html += '<h4>Performance Timing</h4>\n';
      html += '<div class="timing-grid">\n';
      html += `<div class="timing-item"><span class="timing-label">Avg Image Load</span><span class="timing-value">${stats.timing.avgImageLoadMs.toFixed(1)} ms</span></div>\n`;
      html += `<div class="timing-item"><span class="timing-label">Avg Detection</span><span class="timing-value">${stats.timing.avgTotalDetectionMs.toFixed(1)} ms</span></div>\n`;
      html += `<div class="timing-item"><span class="timing-label">Total Time</span><span class="timing-value">${((stats.timing.totalImageLoadMs + stats.timing.totalDetectionMs) / 1000).toFixed(2)} s</span></div>\n`;
      html += `<div class="timing-item"><span class="timing-label">Images Processed</span><span class="timing-value">${stats.timing.imageCount}</span></div>\n`;
      html += '</div>\n';

      // Timing bar visualization
      const totalAvg = stats.timing.avgImageLoadMs + stats.timing.avgTotalDetectionMs;
      if (totalAvg > 0) {
        const loadPct = (stats.timing.avgImageLoadMs / totalAvg * 100).toFixed(0);
        const detectPct = (stats.timing.avgTotalDetectionMs / totalAvg * 100).toFixed(0);
        html += '<div class="timing-bar">\n';
        html += `<div class="timing-bar-segment timing-bar-load" style="width: ${loadPct}%" title="Image Load: ${stats.timing.avgImageLoadMs.toFixed(1)}ms">Load</div>\n`;
        html += `<div class="timing-bar-segment timing-bar-detect" style="width: ${detectPct}%" title="Detection: ${stats.timing.avgTotalDetectionMs.toFixed(1)}ms">Detect</div>\n`;
        html += '</div>\n';
      }

      // Per-family timing table
      if (stats.timing.familyTimings.size > 0) {
        html += '<table class="timing-family-table">\n';
        html += '<tr><th>Family</th><th>Avg Init</th><th>Avg Detect</th><th>Total</th></tr>\n';
        for (const [family, timing] of Array.from(stats.timing.familyTimings.entries()).sort()) {
          html += `<tr><td>${family}</td><td>${timing.avgInit.toFixed(2)} ms</td><td>${timing.avgDetect.toFixed(2)} ms</td><td>${(timing.avgInit + timing.avgDetect).toFixed(2)} ms</td></tr>\n`;
        }
        html += '</table>\n';
      }

      html += '</div>\n';
    }

    html += '</div>\n';
  }

  html += '</div>\n';

  // Per-Image Results
  html += '<h2>Per-Image Results</h2>\n';

  for (const [imageName, result] of Array.from(results.entries()).sort()) {
    html += `<div class="image-section">\n`;
    html += `<h3>${imageName}</h3>\n`;

    // Image viewer with controls
    const imageId = imageName.replace(/[^a-zA-Z0-9]/g, '_');
    html += `<div class="image-viewer">\n`;
    html += `<div class="viewer-controls">\n`;
    html += `<button class="viewer-button active" onclick="showVisualization('${imageId}', 'ground-truth')">Ground Truth</button>\n`;
    for (const detectorName of detectorNames) {
      html += `<button class="viewer-button" onclick="showVisualization('${imageId}', '${detectorName}')">${detectorName}</button>\n`;
    }
    html += `</div>\n`;
    html += `<div id="viewer-${imageId}" class="canvas-container">\n`;
    html += `<canvas id="canvas-${imageId}" style="max-width: 100%; height: auto;"></canvas>\n`;
    html += `</div>\n`;
    html += `</div>\n`;

    // Ground truth tags
    html += '<div class="tag-list">\n';
    html += '<span class="tag-list-label">Ground Truth:</span>\n';
    if (result.groundTruth.length > 0) {
      for (const det of result.groundTruth.sort((a, b) =>
        a.tagFamily.localeCompare(b.tagFamily) || a.tagId - b.tagId)) {
        html += `<span class="tag tag-gt">${det.toString()}</span>\n`;
      }
    } else {
      html += '<span style="color: #999; font-style: italic;">No ground truth tags</span>\n';
    }
    html += '</div>\n';

    // Detector results
    html += '<div class="detector-results">\n';
    for (const detectorName of detectorNames) {
      html += `<div class="detector-result">\n`;
      html += `<h4>${detectorName}</h4>\n`;

      const detected = result.detectorResults.get(detectorName) || [];
      const missed = result.missed.get(detectorName) || new Set();
      const fps = result.falsePositives.get(detectorName) || new Set();
      const timing = result.timings.get(detectorName);

      // Stats
      html += '<div class="stats-row">\n';
      html += `<span class="stat">Detected: ${detected.length}</span>\n`;
      html += `<span class="stat" style="color: #D32F2F;">Missed: ${missed.size}</span>\n`;
      html += `<span class="stat" style="color: #F57C00;">False Pos: ${fps.size}</span>\n`;
      html += '</div>\n';

      // Timing info for this image
      if (timing) {
        html += '<div class="image-timing">\n';
        html += '<div class="image-timing-row"><span class="image-timing-label">Image Load:</span>';
        html += `<span class="image-timing-value">${timing.image_load_ms.toFixed(1)} ms</span></div>\n`;
        html += '<div class="image-timing-row"><span class="image-timing-label">Detection:</span>';
        html += `<span class="image-timing-value">${timing.total_detection_ms.toFixed(1)} ms</span></div>\n`;
        html += '<div class="image-timing-row"><span class="image-timing-label">Total:</span>';
        html += `<span class="image-timing-value">${(timing.image_load_ms + timing.total_detection_ms).toFixed(1)} ms</span></div>\n`;
        html += '</div>\n';
      }

      // Missed tags
      if (missed.size > 0) {
        html += '<div class="tag-list">\n';
        html += '<span class="tag-list-label">Missed:</span>\n';
        for (const det of Array.from(missed).sort((a, b) =>
          a.tagFamily.localeCompare(b.tagFamily) || a.tagId - b.tagId)) {
          html += `<span class="tag tag-missed">${det.toString()}</span>\n`;
        }
        html += '</div>\n';
      }

      // False positives
      if (fps.size > 0) {
        html += '<div class="tag-list">\n';
        html += '<span class="tag-list-label">False Positives:</span>\n';
        for (const det of Array.from(fps).sort((a, b) =>
          a.tagFamily.localeCompare(b.tagFamily) || a.tagId - b.tagId)) {
          html += `<span class="tag tag-fp">${det.toString()}</span>\n`;
        }
        html += '</div>\n';
      }

      html += '</div>\n';
    }

    html += '</div>\n';
    html += '</div>\n';
  }

  // Embed detection data and visualization JavaScript
  html += '<script>\n';

  // Embed all detection data
  html += 'const detectionData = {\n';
  for (const [imageName, result] of Array.from(results.entries()).sort()) {
    const imageId = imageName.replace(/[^a-zA-Z0-9]/g, '_');
    html += `  '${imageId}': {\n`;
    html += `    imagePath: 'data/${imageName}',\n`;

    // Ground truth detections
    const gtFile = join(groundTruthDir, imageName.replace(/\.(jpg|png)$/, '.json'));
    const gtData = loadDetections(gtFile);
    html += `    'ground-truth': ${JSON.stringify(gtData?.detections || [])},\n`;

    // Detector detections
    for (const detectorName of detectorNames) {
      const detectorFile = join(resultsDir, detectorName, imageName.replace(/\.(jpg|png)$/, '.json'));
      const detectorData = loadDetections(detectorFile);
      html += `    '${detectorName}': ${JSON.stringify(detectorData?.detections || [])},\n`;
    }

    html += `  },\n`;
  }
  html += '};\n\n';

  // Add canvas drawing functions
  html += `
function drawDetection(ctx, detection, color) {
  const corners = detection.corners;
  const tagId = detection.tag_id;
  const tagFamily = detection.tag_family;

  // Draw the quadrilateral
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Draw corner circles
  ctx.fillStyle = color;
  for (const corner of corners) {
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Calculate center for label
  const centerX = corners.reduce((sum, c) => sum + c.x, 0) / corners.length;
  const centerY = corners.reduce((sum, c) => sum + c.y, 0) / corners.length;

  // Create label
  const label = tagFamily + ':' + tagId;

  // Set font
  ctx.font = 'bold 16px Arial';
  const metrics = ctx.measureText(label);
  const textWidth = metrics.width;
  const textHeight = 16;

  // Draw background rectangle
  const padding = 5;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(
    centerX - textWidth / 2 - padding,
    centerY - textHeight / 2 - padding,
    textWidth + padding * 2,
    textHeight + padding * 2
  );

  // Draw text
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, centerX, centerY);
}

function drawVisualization(imageId, detector) {
  const canvas = document.getElementById('canvas-' + imageId);
  const ctx = canvas.getContext('2d');
  const data = detectionData[imageId];

  if (!data) return;

  const detections = data[detector];
  const color = detector === 'ground-truth' ? '#00FF00' : '#FFA500';
  const title = detector === 'ground-truth' ? 'Ground Truth' : detector;

  // Load image
  const img = new Image();
  img.onload = function() {
    // Set canvas size to match image
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw the image
    ctx.drawImage(img, 0, 0);

    // Draw all detections
    for (const detection of detections) {
      drawDetection(ctx, detection, color);
    }

    // Add title
    ctx.font = 'bold 24px Arial';
    const titleMetrics = ctx.measureText(title);
    const titleWidth = titleMetrics.width;
    const titleHeight = 24;

    // Draw title background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, titleWidth + 20, titleHeight + 20);

    // Draw title text
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 20, 20);
  };

  img.src = data.imagePath;
}

function showVisualization(imageId, detector) {
  const viewer = document.getElementById('viewer-' + imageId);
  const buttons = viewer.parentElement.querySelectorAll('.viewer-button');

  // Update active button
  buttons.forEach(btn => {
    if (btn.textContent.includes(detector) ||
        (detector === 'ground-truth' && btn.textContent === 'Ground Truth')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Redraw visualization
  drawVisualization(imageId, detector);
}

// Initialize all visualizations on page load
window.addEventListener('load', function() {
  for (const imageId in detectionData) {
    drawVisualization(imageId, 'ground-truth');
  }
});
</script>
`;

  html += `
</body>
</html>
`;

  writeFileSync(outputPath, html, 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);

  let groundTruthDir = 'ground-truth';
  let resultsDir = 'results';
  let dataDir = 'data';
  let detectorNames = ['apriltag-3.4.5', 'apriltags-kaess-3aea96d', 'kornia-apriltag-0.1.10'];
  let outputPath = 'comparison-report.html';

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ground-truth' && i + 1 < args.length) {
      groundTruthDir = args[++i];
    } else if (args[i] === '--results' && i + 1 < args.length) {
      resultsDir = args[++i];
    } else if (args[i] === '--data' && i + 1 < args.length) {
      dataDir = args[++i];
    } else if (args[i] === '--detectors' && i + 1 < args.length) {
      detectorNames = [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        detectorNames.push(args[++i]);
      }
    } else if (args[i] === '--output' && i + 1 < args.length) {
      outputPath = args[++i];
    }
  }

  console.log(`Loading ground truth from: ${groundTruthDir}`);
  console.log(`Loading detector results from: ${resultsDir}`);
  console.log(`Comparing detectors: ${detectorNames.join(', ')}`);

  const results = collectResults(groundTruthDir, resultsDir, detectorNames);

  if (results.size === 0) {
    console.error('Warning: No ground truth files found');
    process.exit(1);
  }

  console.log(`Loaded ${results.size} images`);

  const summaries = computeSummary(results, detectorNames, resultsDir);

  console.log('\nSummary:');
  for (const detectorName of detectorNames) {
    const stats = summaries.get(detectorName)!;
    console.log(`\n${detectorName}:`);
    console.log(`  F1 Score:         ${(stats.f1Score * 100).toFixed(1)}%`);
    console.log(`  Precision:        ${(stats.precision * 100).toFixed(1)}%`);
    console.log(`  Recall:           ${(stats.recall * 100).toFixed(1)}%`);
    console.log(`  True Positives:   ${stats.truePositives}`);
    console.log(`  Missed:           ${stats.missed}`);
    console.log(`  False Positives:  ${stats.falsePositives}`);
    if (stats.timing.imageCount > 0) {
      console.log(`  Avg Load Time:    ${stats.timing.avgImageLoadMs.toFixed(1)} ms`);
      console.log(`  Avg Detect Time:  ${stats.timing.avgTotalDetectionMs.toFixed(1)} ms`);
    }
  }

  generateHtmlReport(results, summaries, detectorNames, outputPath, dataDir, groundTruthDir, resultsDir);

  console.log(`\n✓ Report generated: ${join(process.cwd(), outputPath)}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
