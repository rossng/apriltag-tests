# AprilTag Tests

## strip-exif

Strips all EXIF metadata from images in `data/` to remove identifying information (GPS coordinates, timestamps, camera serial numbers, etc.).

```bash
nix run .#strip-exif
```
