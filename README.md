# AprilTag Tests

Framework for testing and comparing AprilTag detector implementations.

## Structure

- `schema/` - JSON schema and CLI specification
- `data/` - Test images
- `detectors/` - Detector implementations
- `results/` - Detection output (tracked in git)
- `ground-truth/` - Ground truth annotations

## Quick Start

```bash
# Run all detectors
nix run .#run-all-detectors

# Generate comparison report
nix run .#compare-detectors

# Create ground truth annotations
nix run .#edit-ground-truth
```

## Detectors

All detectors follow the same interface: `--input <dir> --output <dir>`

| Command                                            | Description                                |
| -------------------------------------------------- | ------------------------------------------ |
| `nix run .#run-apriltag-3-4-5`                     | AprilTag 3.4.5 (official C implementation) |
| `nix run .#run-apriltags-kaess-3aea96d`            | Michael Kaess' AprilTags library           |
| `nix run .#run-kornia-apriltag-0-1-10`             | Kornia-rs AprilTag 0.1.10                  |
| `nix run .#run-kornia-rs-apriltag-experiment`      | Kornia-rs apriltag-experiment branch       |
| `nix run .#run-kornia-rs-apriltag-centred-coordinates` | Kornia-rs centred-coordinates branch   |
| `nix run .#run-kornia-rs-apriltag-other-fixes`     | Kornia-rs other-fixes branch               |
| `nix run .#run-all-detectors`                      | Run all detectors sequentially             |

## Tools

**Ground Truth Editor** - Web UI for creating annotations

```bash
nix run .#edit-ground-truth  # Opens at http://localhost:5173
```

**Comparison Report** - Compare detectors against ground truth

```bash
nix run .#compare-detectors  # Generates comparison-report.html
```

**Strip EXIF** - Remove metadata from images

```bash
nix run .#strip-exif
```

## Adding Detectors

1. Create `detectors/detector-name/`
2. Implement CLI per `schema/README.md`
3. Add package to `flake.nix`
4. Add run script to `flake.nix`
