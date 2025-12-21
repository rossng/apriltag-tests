# Detector Comparison Tool

TypeScript/Node.js tool that compares AprilTag detector results against ground truth annotations and generates an HTML report.

## Usage

### Via Nix (Recommended)

```bash
# Generate report with default settings
nix run .#compare-detectors

# Specify custom paths
nix run .#compare-detectors <ground-truth-dir> <results-dir> <output-file>
```

### Direct Node.js

```bash
cd tools/compare-detectors
npm install
npm run build
node dist/compare.js \
  --ground-truth ../../ground-truth/ \
  --results ../../results/ \
  --detectors apriltag-3.4.5 apriltags-kaess \
  --output ../../comparison-report.html
```

## Command Line Options

- `--ground-truth <dir>` - Directory containing ground truth JSON files (default: `ground-truth`)
- `--results <dir>` - Directory containing detector result subdirectories (default: `results`)
- `--detectors <name1> <name2> ...` - List of detector names to compare (default: `apriltag-3.4.5 apriltags-kaess`)
- `--output <file>` - Output HTML file path (default: `comparison-report.html`)

## Report Contents

### Summary Statistics

For each detector:
- **F1 Score** - Harmonic mean of precision and recall
- **Precision** - Ratio of true positives to all detections
- **Recall** - Ratio of true positives to ground truth tags
- **True Positives** - Correctly detected tags
- **Missed Detections** - Ground truth tags not detected
- **False Positives** - Detected tags not in ground truth
- **Family Breakdown** - Missed/false positive counts per tag family

### Per-Image Results

For each image:
- Ground truth tags
- Per-detector results showing:
  - Detection counts
  - Missed tags (in ground truth but not detected)
  - False positives (detected but not in ground truth)

## Metrics Explained

### Precision
```
Precision = True Positives / (True Positives + False Positives)
```
Measures how many of the detector's outputs were correct.

### Recall
```
Recall = True Positives / (True Positives + Missed Detections)
```
Measures how many of the ground truth tags were found.

### F1 Score
```
F1 = 2 × (Precision × Recall) / (Precision + Recall)
```
Balanced metric combining precision and recall.

## Matching Logic

Two detections are considered the same if they have:
1. Identical `tag_id`
2. Identical `tag_family`

Corner positions are not currently used for matching.

## Example Output

```
Summary:

apriltag-3.4.5:
  F1 Score:         82.4%
  Precision:        70.0%
  Recall:           100.0%
  True Positives:   14
  Missed:           0
  False Positives:  5
```

## Requirements

- Node.js 18+
- TypeScript 5.0+
- No external runtime dependencies (uses only Node.js standard library)
