# AprilTag 3.4.5 Detector

C++ implementation of AprilTag detector using the official AprilTag library v3.4.5.

## Features

- Supports all AprilTag families:
  - tag36h11
  - tag25h9
  - tag16h5
  - tagCircle21h7
  - tagCircle49h12
  - tagCustom48h12
  - tagStandard41h12
  - tagStandard52h13
- Processes JPG and PNG images
- Outputs JSON conforming to `schema/detection-format.json`
- Uses stb_image for image loading (no OpenCV dependency)

## Building

Built automatically via Nix:

```bash
nix build .#apriltag-3-4-5-detector
```

## Running

Via wrapper script:

```bash
nix run .#run-apriltag-3-4-5 [input-dir] [output-dir]
```

Or directly:

```bash
./result/bin/apriltag-3-4-5-detector --input <dir> --output <dir>
```

## Implementation Details

- **Language**: C++17
- **Build system**: CMake
- **Image loading**: stb_image (header-only library)
- **AprilTag library**: v3.4.5 (built from source via Nix)
- **Detection**: All tag families loaded simultaneously for comprehensive detection
