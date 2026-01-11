use anyhow::{Context, Result};
use kornia_apriltag::{AprilTagDecoder, DecodeTagsConfig};
use kornia_apriltag::family::TagFamilyKind;
use kornia_image::{Image, ImageSize};
use kornia_image::allocator::CpuAllocator;
use kornia_imgproc::color::gray_from_rgb_u8;
use kornia_io::jpeg::read_image_jpeg_rgb8;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::Instant;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FamilyTiming {
    family: String,
    initialization_ms: f64,
    detection_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Timings {
    image_load_ms: f64,
    total_detection_ms: f64,
    family_timings: Vec<FamilyTiming>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DetectionResult {
    image: String,
    detections: Vec<Detection>,
    timings: Timings,
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

struct DetectionWithTiming {
    detections: Vec<Detection>,
    family_timing: FamilyTiming,
}

fn detect_in_image(
    img_gray: &Image<u8, 1, CpuAllocator>,
    family_name: &str,
    family_kind: &TagFamilyKind,
) -> Result<DetectionWithTiming> {
    let img_size = ImageSize {
        width: img_gray.width(),
        height: img_gray.height(),
    };

    // Time initialization
    let init_start = Instant::now();
    let config = DecodeTagsConfig::new(vec![family_kind.clone()])?;
    let mut decoder = AprilTagDecoder::new(config, img_size)?;
    let init_duration = init_start.elapsed();

    // Time detection
    let detect_start = Instant::now();
    let detections = decoder.decode(img_gray)
        .context(format!("Failed to decode tags for family {:?}", family_kind))?;
    let detect_duration = detect_start.elapsed();

    // Convert detections to our format
    let mut result_detections = Vec::new();
    for det in detections {
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

    Ok(DetectionWithTiming {
        detections: result_detections,
        family_timing: FamilyTiming {
            family: family_name.to_string(),
            initialization_ms: init_duration.as_secs_f64() * 1000.0,
            detection_ms: detect_duration.as_secs_f64() * 1000.0,
        },
    })
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

    // Time image loading
    let load_start = Instant::now();
    let img_rgb = read_image_jpeg_rgb8(image_path)
        .context("Failed to load image")?;
    let mut img_gray = Image::<u8, 1, CpuAllocator>::from_size_val(img_rgb.size(), 0, CpuAllocator)?;
    gray_from_rgb_u8(&img_rgb, &mut img_gray)?;
    let load_duration = load_start.elapsed();

    let mut all_detections = Vec::new();
    let mut family_timings = Vec::new();
    let mut total_detection_ms = 0.0;

    // Process all families for this image
    for (family_name, family_kind) in families {
        println!("Processing {} for family {}...", image_path.display(), family_name);

        let result = detect_in_image(&img_gray, family_name, family_kind)?;

        total_detection_ms += result.family_timing.initialization_ms + result.family_timing.detection_ms;
        all_detections.extend(result.detections);
        family_timings.push(result.family_timing);
    }

    Ok(DetectionResult {
        image: image_name,
        detections: all_detections,
        timings: Timings {
            image_load_ms: load_duration.as_secs_f64() * 1000.0,
            total_detection_ms,
            family_timings,
        },
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

        if ext == "jpg" || ext == "jpeg" {
            image_paths.push(path);
        }
    }

    if image_paths.is_empty() {
        println!("No images found in {}", input_dir);
        return Ok(());
    }

    // Process each image and write output immediately
    let mut processed_count = 0;
    for image_path in &image_paths {
        let result = process_image(image_path, &families)?;

        println!("Writing results for {}: {} detections", result.image, result.detections.len());

        // Write output JSON
        let output_filename = image_path
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
