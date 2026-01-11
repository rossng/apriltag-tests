#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>
#include <cstring>
#include <algorithm>
#include <chrono>

extern "C" {
#include "apriltag.h"
#include "tag36h11.h"
#include "tag25h9.h"
#include "tag16h5.h"
#include "tagCircle21h7.h"
#include "tagCircle49h12.h"
#include "tagCustom48h12.h"
#include "tagStandard41h12.h"
#include "tagStandard52h13.h"
}

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

namespace fs = std::filesystem;

struct Corner {
    double x, y;
};

struct Detection {
    int tag_id;
    std::string tag_family;
    std::vector<Corner> corners;
};

struct FamilyTiming {
    std::string family;
    double initialization_ms;
    double detection_ms;
};

struct Timings {
    double image_load_ms;
    double total_detection_ms;
    std::vector<FamilyTiming> family_timings;
};

struct DetectionResult {
    std::string image;
    std::vector<Detection> detections;
    Timings timings;
};

std::string escape_json_string(const std::string& str) {
    std::string result;
    for (char c : str) {
        if (c == '"') result += "\\\"";
        else if (c == '\\') result += "\\\\";
        else if (c == '\n') result += "\\n";
        else if (c == '\r') result += "\\r";
        else if (c == '\t') result += "\\t";
        else result += c;
    }
    return result;
}

std::string to_json(const DetectionResult& result) {
    std::string json = "{\n";
    json += "  \"image\": \"" + escape_json_string(result.image) + "\",\n";
    json += "  \"detections\": [\n";

    for (size_t i = 0; i < result.detections.size(); ++i) {
        const auto& det = result.detections[i];
        json += "    {\n";
        json += "      \"tag_id\": " + std::to_string(det.tag_id) + ",\n";
        json += "      \"tag_family\": \"" + escape_json_string(det.tag_family) + "\",\n";
        json += "      \"corners\": [\n";

        for (size_t j = 0; j < det.corners.size(); ++j) {
            const auto& corner = det.corners[j];
            json += "        {\"x\": " + std::to_string(corner.x) + ", \"y\": " + std::to_string(corner.y) + "}";
            if (j < det.corners.size() - 1) json += ",";
            json += "\n";
        }

        json += "      ]\n";
        json += "    }";
        if (i < result.detections.size() - 1) json += ",";
        json += "\n";
    }

    json += "  ],\n";

    // Add timings
    json += "  \"timings\": {\n";
    json += "    \"image_load_ms\": " + std::to_string(result.timings.image_load_ms) + ",\n";
    json += "    \"total_detection_ms\": " + std::to_string(result.timings.total_detection_ms) + ",\n";
    json += "    \"family_timings\": [\n";

    for (size_t i = 0; i < result.timings.family_timings.size(); ++i) {
        const auto& ft = result.timings.family_timings[i];
        json += "      {\n";
        json += "        \"family\": \"" + escape_json_string(ft.family) + "\",\n";
        json += "        \"initialization_ms\": " + std::to_string(ft.initialization_ms) + ",\n";
        json += "        \"detection_ms\": " + std::to_string(ft.detection_ms) + "\n";
        json += "      }";
        if (i < result.timings.family_timings.size() - 1) json += ",";
        json += "\n";
    }

    json += "    ]\n";
    json += "  }\n";
    json += "}\n";
    return json;
}

DetectionResult process_image(const std::string& image_path,
                              const std::vector<std::pair<std::string, apriltag_family_t*>>& families) {
    DetectionResult result;
    result.image = fs::path(image_path).filename().string();
    result.timings.total_detection_ms = 0.0;

    // Time image loading
    auto load_start = std::chrono::high_resolution_clock::now();

    int width, height, channels;
    unsigned char* img_data = stbi_load(image_path.c_str(), &width, &height, &channels, 1);

    auto load_end = std::chrono::high_resolution_clock::now();
    result.timings.image_load_ms = std::chrono::duration<double, std::milli>(load_end - load_start).count();

    if (!img_data) {
        std::cerr << "Failed to load image: " << image_path << std::endl;
        return result;
    }

    image_u8_t im = {
        .width = width,
        .height = height,
        .stride = width,
        .buf = img_data
    };

    // Process each family separately to show progress
    for (const auto& [family_name, tf] : families) {
        std::cout << "  Detecting " << family_name << "..." << std::flush;

        FamilyTiming family_timing;
        family_timing.family = family_name;

        // Time initialization
        auto init_start = std::chrono::high_resolution_clock::now();

        apriltag_detector_t* td = apriltag_detector_create();

        // Set hamming distance for specific families
        if (family_name == "tagCircle49h12" || family_name == "tagStandard52h13") {
            apriltag_detector_add_family_bits(td, tf, 1);
        } else {
            apriltag_detector_add_family(td, tf);
        }

        auto init_end = std::chrono::high_resolution_clock::now();
        family_timing.initialization_ms = std::chrono::duration<double, std::milli>(init_end - init_start).count();

        // Time detection
        auto detect_start = std::chrono::high_resolution_clock::now();

        zarray_t* detections = apriltag_detector_detect(td, &im);

        auto detect_end = std::chrono::high_resolution_clock::now();
        family_timing.detection_ms = std::chrono::duration<double, std::milli>(detect_end - detect_start).count();

        result.timings.total_detection_ms += family_timing.initialization_ms + family_timing.detection_ms;
        result.timings.family_timings.push_back(family_timing);

        int count = zarray_size(detections);

        for (int i = 0; i < count; i++) {
            apriltag_detection_t* det;
            zarray_get(detections, i, &det);

            Detection detection;
            detection.tag_id = det->id;
            detection.tag_family = det->family->name;

            // Corners are ordered: bottom-left, bottom-right, top-right, top-left (counter-clockwise)
            for (int j = 0; j < 4; j++) {
                Corner corner;
                corner.x = det->p[j][0];
                corner.y = det->p[j][1];
                detection.corners.push_back(corner);
            }

            result.detections.push_back(detection);
        }

        std::cout << " found " << count << std::endl;

        apriltag_detections_destroy(detections);
        apriltag_detector_destroy(td);
    }

    stbi_image_free(img_data);

    return result;
}

void print_usage(const char* program_name) {
    std::cerr << "Usage: " << program_name << " --input <input-directory> --output <output-directory>" << std::endl;
}

int main(int argc, char* argv[]) {
    std::string input_dir;
    std::string output_dir;

    // Parse command line arguments
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            input_dir = argv[++i];
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            output_dir = argv[++i];
        } else {
            std::cerr << "Unknown argument: " << argv[i] << std::endl;
            print_usage(argv[0]);
            return 1;
        }
    }

    if (input_dir.empty() || output_dir.empty()) {
        std::cerr << "Error: Both --input and --output arguments are required" << std::endl;
        print_usage(argv[0]);
        return 1;
    }

    if (!fs::exists(input_dir)) {
        std::cerr << "Error: Input directory does not exist: " << input_dir << std::endl;
        return 1;
    }

    // Create output directory if it doesn't exist
    fs::create_directories(output_dir);

    // Initialize all AprilTag families
    std::vector<std::pair<std::string, apriltag_family_t*>> families = {
        {"tag36h11", tag36h11_create()},
        {"tag25h9", tag25h9_create()},
        {"tag16h5", tag16h5_create()},
        {"tagCircle21h7", tagCircle21h7_create()},
        {"tagCircle49h12", tagCircle49h12_create()},
        {"tagCustom48h12", tagCustom48h12_create()},
        {"tagStandard41h12", tagStandard41h12_create()},
        {"tagStandard52h13", tagStandard52h13_create()}
    };

    // Process all image files in input directory
    int processed_count = 0;
    for (const auto& entry : fs::directory_iterator(input_dir)) {
        if (!entry.is_regular_file()) continue;

        std::string ext = entry.path().extension().string();
        std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

        if (ext != ".jpg" && ext != ".jpeg" && ext != ".png") continue;

        std::string input_path = entry.path().string();
        std::string output_filename = entry.path().stem().string() + ".json";
        std::string output_path = (fs::path(output_dir) / output_filename).string();

        std::cout << "Processing: " << entry.path().filename().string() << std::endl;

        DetectionResult result = process_image(input_path, families);

        std::ofstream out(output_path);
        if (!out) {
            std::cerr << "Error: Failed to write output file: " << output_path << std::endl;
            continue;
        }

        out << to_json(result);
        out.close();

        processed_count++;
    }

    std::cout << "Processed " << processed_count << " images" << std::endl;

    // Write manifest.json
    std::string manifest_path = (fs::path(output_dir) / "manifest.json").string();
    std::ofstream manifest_out(manifest_path);
    if (manifest_out) {
        manifest_out << "{\n";
        manifest_out << "  \"supported_families\": [\n";
        for (size_t i = 0; i < families.size(); ++i) {
            manifest_out << "    \"" << families[i].first << "\"";
            if (i < families.size() - 1) manifest_out << ",";
            manifest_out << "\n";
        }
        manifest_out << "  ]\n";
        manifest_out << "}\n";
        manifest_out.close();
        std::cout << "Wrote manifest: " << manifest_path << std::endl;
    }

    // Cleanup
    for (const auto& [name, tf] : families) {
        if (name == "tag36h11") tag36h11_destroy(tf);
        else if (name == "tag25h9") tag25h9_destroy(tf);
        else if (name == "tag16h5") tag16h5_destroy(tf);
        else if (name == "tagCircle21h7") tagCircle21h7_destroy(tf);
        else if (name == "tagCircle49h12") tagCircle49h12_destroy(tf);
        else if (name == "tagCustom48h12") tagCustom48h12_destroy(tf);
        else if (name == "tagStandard41h12") tagStandard41h12_destroy(tf);
        else if (name == "tagStandard52h13") tagStandard52h13_destroy(tf);
    }

    return 0;
}
