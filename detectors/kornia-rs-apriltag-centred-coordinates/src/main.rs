use anyhow::{Context, Result};
use kornia_apriltag::{AprilTagDecoder, DecodeTagsConfig};
use kornia_apriltag::family::TagFamilyKind;
use kornia_image::{Image, ImageSize};
use kornia_image::allocator::CpuAllocator;
use kornia_imgproc::color::gray_from_rgb_u8;
use kornia_io::jpeg::read_image_jpeg_rgb8;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Corner {
    x: f32,
    y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Detection {
    tag_id: u16,
    tag_family: String,
    corners: Vec<Corner>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DetectionResult {
    image: String,
    detections: Vec<Detection>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    supported_families: Vec<String>,
}

fn tag_family_to_string(kind: &TagFamilyKind) -> String {
    match kind {
        TagFamilyKind::Tag16H5 => "tag16h5".to_string(),
        TagFamilyKind::Tag36H11 => "tag36h11".to_string(),
        TagFamilyKind::Tag36H10 => "tag36h10".to_string(),
        TagFamilyKind::Tag25H9 => "tag25h9".to_string(),
        TagFamilyKind::TagCircle21H7 => "tagCircle21h7".to_string(),
        TagFamilyKind::TagCircle49H12 => "tagCircle49h12".to_string(),
        TagFamilyKind::TagCustom48H12 => "tagCustom48h12".to_string(),
        TagFamilyKind::TagStandard41H12 => "tagStandard41h12".to_string(),
        TagFamilyKind::TagStandard52H13 => "tagStandard52h13".to_string(),
        TagFamilyKind::Custom(_) => "custom".to_string(),
    }
}

fn get_supported_families() -> Vec<(String, TagFamilyKind)> {
    vec![
        ("tag36h11".to_string(), TagFamilyKind::Tag36H11),
        ("tag36h10".to_string(), TagFamilyKind::Tag36H10),
        ("tag25h9".to_string(), TagFamilyKind::Tag25H9),
        ("tag16h5".to_string(), TagFamilyKind::Tag16H5),
        ("tagCircle21h7".to_string(), TagFamilyKind::TagCircle21H7),
        ("tagCircle49h12".to_string(), TagFamilyKind::TagCircle49H12),
        ("tagCustom48h12".to_string(), TagFamilyKind::TagCustom48H12),
        ("tagStandard41h12".to_string(), TagFamilyKind::TagStandard41H12),
        ("tagStandard52h13".to_string(), TagFamilyKind::TagStandard52H13),
    ]
}

fn detect_in_image(
    image_path: &Path,
    family_kind: &TagFamilyKind,
    img_size: ImageSize,
) -> Result<Vec<Detection>> {
    // Load image as RGB8
    let img_rgb = read_image_jpeg_rgb8(image_path)
        .context("Failed to load image")?;

    // Convert to grayscale directly from u8
    let mut img_gray = Image::<u8, 1, CpuAllocator>::from_size_val(img_rgb.size(), 0, CpuAllocator)?;
    gray_from_rgb_u8(&img_rgb, &mut img_gray)?;

    // Create a fresh decoder for this image
    let config = DecodeTagsConfig::new(vec![family_kind.clone()]);
    let mut decoder = AprilTagDecoder::new(config, img_size)?;

    // Detect tags
    let detections = decoder.decode(&img_gray)
        .context(format!("Failed to decode tags for family {:?}", family_kind))?;

    // Convert detections to our format
    let mut result_detections = Vec::new();
    for det in detections {
        // Corners are in order: Bottom-left, Bottom-right, Top-right, Top-left
        // This matches our required format (counter-clockwise from bottom-left)
        let corners = vec![
            Corner {
                x: det.quad.corners[0].x,
                y: det.quad.corners[0].y,
            },
            Corner {
                x: det.quad.corners[1].x,
                y: det.quad.corners[1].y,
            },
            Corner {
                x: det.quad.corners[2].x,
                y: det.quad.corners[2].y,
            },
            Corner {
                x: det.quad.corners[3].x,
                y: det.quad.corners[3].y,
            },
        ];

        result_detections.push(Detection {
            tag_id: det.id,
            tag_family: tag_family_to_string(&det.tag_family_kind),
            corners,
        });
    }

    Ok(result_detections)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 || args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!("Usage: {} --input <input-directory> --output <output-directory>", args[0]);
        std::process::exit(1);
    }

    let mut input_dir: Option<String> = None;
    let mut output_dir: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--input" => {
                if i + 1 < args.len() {
                    input_dir = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!("--input requires a value");
                }
            }
            "--output" => {
                if i + 1 < args.len() {
                    output_dir = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    anyhow::bail!("--output requires a value");
                }
            }
            _ => {
                anyhow::bail!("Unknown argument: {}", args[i]);
            }
        }
    }

    let input_dir = input_dir.context("--input is required")?;
    let output_dir = output_dir.context("--output is required")?;

    let input_path = Path::new(&input_dir);
    let output_path = Path::new(&output_dir);

    if !input_path.exists() {
        anyhow::bail!("Input directory does not exist: {}", input_dir);
    }

    // Create output directory
    fs::create_dir_all(output_path)
        .context("Failed to create output directory")?;

    let families = get_supported_families();

    // Collect all image paths first
    let mut image_paths = Vec::new();
    for entry in fs::read_dir(input_path)? {
        let entry = entry?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "jpg" || ext == "jpeg" || ext == "png" {
            image_paths.push(path);
        }
    }

    if image_paths.is_empty() {
        println!("No images found in {}", input_dir);
        return Ok(());
    }

    // Get the size of the first image to create decoders
    let first_img = read_image_jpeg_rgb8(&image_paths[0])
        .context("Failed to load first image")?;
    let img_size = ImageSize {
        width: first_img.width(),
        height: first_img.height(),
    };

    // Store all detections per image (image_path -> detections)
    let mut all_image_detections: HashMap<String, Vec<Detection>> = HashMap::new();

    // Process each image
    for image_path in &image_paths {
        let path_str = image_path.to_string_lossy().to_string();

        // Process all families for this image
        for (family_name, family_kind) in &families {
            println!("Processing {} for family {}...", image_path.display(), family_name);

            let detections = detect_in_image(image_path, family_kind, img_size)?;

            all_image_detections
                .entry(path_str.clone())
                .or_insert_with(Vec::new)
                .extend(detections);
        }
    }

    // Write output files
    let mut processed_count = 0;
    for path in &image_paths {
        let image_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .context("Invalid image filename")?;

        let path_str = path.to_string_lossy().to_string();
        let detections = all_image_detections.get(&path_str).cloned().unwrap_or_default();

        println!("Writing results for {}: {} detections", image_name, detections.len());

        let result = DetectionResult {
            image: image_name.to_string(),
            detections,
        };

        // Write output JSON
        let output_filename = path
            .file_stem()
            .and_then(|s| s.to_str())
            .context("Invalid filename")?;
        let output_file = output_path.join(format!("{}.json", output_filename));

        let json = serde_json::to_string_pretty(&result)?;
        fs::write(&output_file, json)
            .context(format!("Failed to write {:?}", output_file))?;

        processed_count += 1;
    }

    println!("Processed {} images", processed_count);

    // Write manifest
    let manifest = Manifest {
        supported_families: families.iter().map(|(name, _)| name.clone()).collect(),
    };
    let manifest_path = output_path.join("manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    fs::write(&manifest_path, manifest_json)
        .context("Failed to write manifest")?;
    println!("Wrote manifest: {:?}", manifest_path);

    Ok(())
}
