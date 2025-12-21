# AprilTag Tests

Framework for testing and comparing different AprilTag detector implementations across versions and libraries.

## Directory Structure

- `schema/` - JSON Schema and CLI specification for detector programs
- `data/` - Test images containing AprilTags
- `detectors/` - Detector implementations (e.g., `apriltag-3.4.5/`)
- `results/` - Detection output (gitignored)

## Detection Format

All detectors output JSON results conforming to the schema in `schema/detection-format.json`. Each detection includes:
- `tag_id` - Numeric ID of the detected tag
- `tag_family` - Family name (e.g., "tag36h11", "tag25h9")
- `corners` - Array of 4 corner positions (x, y) in pixels, counter-clockwise from bottom-left

See `schema/README.md` for full CLI specification.

## Running Detectors

### AprilTag 3.4.5

```bash
# Run on data/ folder, output to results/apriltag-3.4.5/
nix run .#run-apriltag-3-4-5

# Run on custom folders
nix run .#run-apriltag-3-4-5 custom-input/ custom-output/
```

The detector supports all AprilTag families: tag36h11, tag25h9, tag16h5, tagCircle21h7, tagCircle49h12, tagCustom48h12, tagStandard41h12, tagStandard52h13.

## Ground Truth Annotation

### edit-ground-truth

Web-based tool for creating and editing ground truth annotations.

```bash
nix run .#edit-ground-truth
# Open http://localhost:3000 in your browser
```

Features:
- Visual annotation with precise corner placement
- Magnified view for accuracy
- Import detections from detector results
- Filter by tag family when importing
- Save to `ground-truth/` folder

See `tools/ground-truth-editor/README.md` for details.

## Utilities

### strip-exif

Strips all EXIF metadata from images in `data/` to remove identifying information (GPS coordinates, timestamps, camera serial numbers, etc.).

```bash
nix run .#strip-exif
```

## Adding New Detectors

1. Create directory: `detectors/detector-name/`
2. Implement detector following `schema/README.md` CLI specification
3. Add package definition to `flake.nix`
4. Add wrapper script app to `flake.nix`
5. Test against images in `data/`
