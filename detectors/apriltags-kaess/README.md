# AprilTags Kaess Detector

Detector implementation using Michael Kaess' AprilTags library from https://bitbucket.org/kaess/apriltags/.

## Library Version

Commit: 3aea96d3239bb83870cb5e0a85f142a2b0589563

## Supported Tag Families

- tag36h11
- tag36h9
- tag25h9
- tag25h7
- tag16h5

## Implementation Notes

This detector uses the C++ AprilTags library by Michael Kaess, which predates the AprilRobotics version. The library uses OpenCV for image processing and Eigen for linear algebra.

The library is built with patches to:
- Update CMake minimum version to 3.15
- Disable problematic pkg-config file generation
- Disable example subdirectory

## Building

Built using Nix flake. See `flake.nix` for build configuration.

```bash
nix build .#apriltags-kaess-detector
```

## Running

```bash
nix run .#run-apriltags-kaess
```
