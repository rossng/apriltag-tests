#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>
#include <cstring>

#include <opencv2/opencv.hpp>

#include "AprilTags/TagDetector.h"
#include "AprilTags/Tag16h5.h"
#include "AprilTags/Tag25h7.h"
#include "AprilTags/Tag25h9.h"
#include "AprilTags/Tag36h9.h"
#include "AprilTags/Tag36h11.h"

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

struct DetectionResult {
    std::string image;
    std::vector<Detection> detections;
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

    json += "  ]\n";
    json += "}\n";
    return json;
}

DetectionResult process_image(const std::string& image_path,
                              const std::vector<std::pair<std::string, AprilTags::TagCodes>>& families) {
    DetectionResult result;
    result.image = fs::path(image_path).filename().string();

    int width, height, channels;
    unsigned char* img_data = stbi_load(image_path.c_str(), &width, &height, &channels, 1);

    if (!img_data) {
        std::cerr << "Failed to load image: " << image_path << std::endl;
        return result;
    }

    // Convert to cv::Mat for Kaess library
    cv::Mat image_gray(height, width, CV_8UC1, img_data);

    // Process each family separately to show progress
    for (const auto& [family_name, tag_codes] : families) {
        std::cout << "  Detecting " << family_name << "..." << std::flush;

        AprilTags::TagDetector detector(tag_codes);
        std::vector<AprilTags::TagDetection> detections = detector.extractTags(image_gray);
        int count = detections.size();

        for (const auto& det : detections) {
            Detection detection;
            detection.tag_id = det.id;
            detection.tag_family = family_name;

            // Kaess library provides corners in this order: bottom-left, bottom-right, top-right, top-left
            // which matches our required format (counter-clockwise from bottom-left)
            Corner bl = {det.p[0].first, det.p[0].second};
            Corner br = {det.p[1].first, det.p[1].second};
            Corner tr = {det.p[2].first, det.p[2].second};
            Corner tl = {det.p[3].first, det.p[3].second};

            detection.corners.push_back(bl);
            detection.corners.push_back(br);
            detection.corners.push_back(tr);
            detection.corners.push_back(tl);

            result.detections.push_back(detection);
        }

        std::cout << " found " << count << std::endl;
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
    std::vector<std::pair<std::string, AprilTags::TagCodes>> families = {
        {"tag36h11", AprilTags::tagCodes36h11},
        {"tag36h9", AprilTags::tagCodes36h9},
        {"tag25h9", AprilTags::tagCodes25h9},
        {"tag25h7", AprilTags::tagCodes25h7},
        {"tag16h5", AprilTags::tagCodes16h5}
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

    return 0;
}
