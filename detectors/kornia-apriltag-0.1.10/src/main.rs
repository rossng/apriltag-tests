use anyhow::{Context, Result};
use kornia_apriltag::{AprilTagDecoder, DecodeTagsConfig};
use kornia_apriltag::family::TagFamilyKind;
use kornia_image::{Image, ImageSize};
use kornia_image::allocator::CpuAllocator;
use kornia_imgproc::color::gray_from_rgb;
use kornia_io::functional as K;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
struct Corner {
    x: f32,
    y: f32,
}

#[derive(Debug, Serialize, Deserialize)]
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

fn process_image(
    image_path: &Path,
    families: &[(String, TagFamilyKind)],
) -> Result<DetectionResult> {
    let image_name = image_path
        .file_name()
        .and_then(|n| n.to_str())
        .context("Invalid image filename")?
        .to_string();

    println!("Processing: {}", image_name);

    // Load image as RGB8
    let img_rgb: Image<u8, 3, CpuAllocator> = K::read_image_any_rgb8(image_path)
        .context("Failed to load image")?;

    // Convert to f32 and scale to [0, 1]
    let img_rgb_f32: Image<f32, 3, CpuAllocator> = img_rgb.cast_and_scale::<f32>(1.0f32 / 255.0f32)?;

    // Convert to grayscale
    let mut img_gray_f32 = Image::<f32, 1, CpuAllocator>::from_size_val(img_rgb_f32.size(), 0.0, CpuAllocator)?;
    gray_from_rgb(&img_rgb_f32, &mut img_gray_f32)?;

    // Convert back to u8 for the detector
    let img_gray: Image<u8, 1, CpuAllocator> = img_gray_f32.cast_and_scale::<u8>(255u8)?;

    let img_size = ImageSize {
        width: img_gray.width(),
        height: img_gray.height(),
    };

    let mut all_detections = Vec::new();
    let mut family_counts: HashMap<String, usize> = HashMap::new();

    // Process each family
    for (family_name, family_kind) in families {
        // Create decoder for this family
        let config = DecodeTagsConfig::new(vec![family_kind.clone()]);

        let mut decoder = AprilTagDecoder::new(config, img_size)?;

        // Detect tags
        let detections = decoder.decode(&img_gray)
            .context(format!("Failed to decode tags for family {}", family_name))?;

        let count = detections.len();
        family_counts.insert(family_name.clone(), count);

        // Convert detections to our format
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

            all_detections.push(Detection {
                tag_id: det.id,
                tag_family: tag_family_to_string(&det.tag_family_kind),
                corners,
            });
        }
    }

    // Print summary
    for (family_name, count) in &family_counts {
        println!("  Detecting {}... found {}", family_name, count);
    }

    Ok(DetectionResult {
        image: image_name,
        detections: all_detections,
    })
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

    // Process all images
    let mut processed_count = 0;
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

        if ext != "jpg" && ext != "jpeg" && ext != "png" {
            continue;
        }

        let result = process_image(&path, &families)?;

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
