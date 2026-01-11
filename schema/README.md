# AprilTag Detector Interface Specification

## Detection Output Format

All detector programs must output results in JSON format conforming to [detection-format.json](detection-format.json).

### Example Output

```json
{
  "image": "image1.jpg",
  "detections": [
    {
      "tag_id": 42,
      "tag_family": "tag36h11",
      "corners": [
        {"x": 100.5, "y": 200.3},
        {"x": 150.2, "y": 201.1},
        {"x": 149.8, "y": 251.6},
        {"x": 99.9, "y": 250.8}
      ]
    }
  ],
  "timings": {
    "image_load_ms": 15.234,
    "total_detection_ms": 125.678,
    "family_timings": [
      {
        "family": "tag36h11",
        "initialization_ms": 0.523,
        "detection_ms": 45.123
      },
      {
        "family": "tag25h9",
        "initialization_ms": 0.412,
        "detection_ms": 39.876
      }
    ]
  }
}
```

### Corner Ordering

Corners are ordered **counter-clockwise** starting from the **bottom-left** corner:
1. Bottom-left
2. Bottom-right
3. Top-right
4. Top-left

### Timing Information

The `timings` object provides performance metrics for the detection process:

- `image_load_ms`: Time to load and preprocess the image (reading from disk, converting to grayscale, etc.)
- `total_detection_ms`: Sum of all initialization and detection times across all tag families
- `family_timings`: Per-family breakdown with:
  - `family`: Name of the tag family (e.g., "tag36h11")
  - `initialization_ms`: Time to create/configure the detector for this family
  - `detection_ms`: Time to actually detect tags of this family in the image

## Command Line Interface

All detector programs must implement the following CLI:

```bash
<detector-program> --input <input-directory> --output <output-directory>
```

### Arguments

- `--input <path>`: Directory containing input images
- `--output <path>`: Directory where JSON results will be written

### Expected Behavior

1. Process all `.jpg` and `.png` files in the input directory (non-recursive)
2. For each image file, detect AprilTags and generate a JSON output file
3. Output files are named `<image-basename>.json` in the output directory
   - Example: `image1.jpg` → `image1.json`
4. Create output directory if it doesn't exist
5. Exit with status 0 on success, non-zero on error
6. Write errors to stderr, minimal progress information to stdout

### Example Usage

```bash
# Run detector on all images in data/ folder
detector --input data/ --output results/detector-name/

# This processes:
#   data/image1.jpg  → results/detector-name/image1.json
#   data/image2.png  → results/detector-name/image2.json
```

## Implementation Requirements

- Support at least `.jpg` and `.png` image formats
- Handle missing input directory gracefully (error message)
- Overwrite existing output files without warning
- Empty detections array is valid when no tags are detected
- Preserve exact pixel coordinates from detector library (subpixel precision)
- Include timing information for performance analysis
