{
  description = "AprilTag tests with EXIF data stripping utilities";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # AprilTag 3.4.5 library
        apriltag-3-4-5 = pkgs.stdenv.mkDerivation {
          pname = "apriltag";
          version = "3.4.5";

          src = pkgs.fetchFromGitHub {
            owner = "AprilRobotics";
            repo = "apriltag";
            rev = "v3.4.5";
            hash = "sha256-pBUjRKfP884+bNgV5B4b8TiuhyZ9p/jIluxs+idv/28=";
          };

          nativeBuildInputs = [ pkgs.cmake ];

          cmakeFlags = [ "-DBUILD_EXAMPLES=OFF" ];

          meta = {
            description = "AprilTag visual fiducial system v3.4.5";
            homepage = "https://april.eecs.umich.edu/software/apriltag";
            license = pkgs.lib.licenses.bsd2;
          };
        };

        # Michael Kaess' apriltags library (commit 3aea96d)
        apriltags-kaess = pkgs.stdenv.mkDerivation {
          pname = "apriltags-kaess";
          version = "unstable-2024-09-21";

          src = pkgs.fetchFromBitbucket {
            owner = "kaess";
            repo = "apriltags";
            rev = "3aea96d3239bb83870cb5e0a85f142a2b0589563";
            hash = "sha256-f19R7pm0P/LFwXw4uqU6YgEediINHEAAXrkv8DG/eXg=";
          };

          nativeBuildInputs = [ pkgs.cmake pkgs.pkg-config ];
          buildInputs = [ pkgs.opencv pkgs.eigen ];

          # Fix CMake minimum version requirement and compatibility issues
          postPatch = ''
            sed -i 's/cmake_minimum_required(VERSION 2.6)/cmake_minimum_required(VERSION 3.15)/' CMakeLists.txt
            # Comment out problematic pods_install_pkg_config_file call (lines 30-33)
            sed -i '30,33s/^/#/' CMakeLists.txt
            # Comment out add_subdirectory(example) since we're not building examples
            sed -i 's/^add_subdirectory(example)/#add_subdirectory(example)/' CMakeLists.txt
          '';

          cmakeFlags = [ "-DBUILD_EXAMPLES=OFF" ];

          meta = {
            description = "AprilTag visual fiducial system by Michael Kaess";
            homepage = "https://bitbucket.org/kaess/apriltags";
            license = pkgs.lib.licenses.lgpl21;
          };
        };

        # AprilTag 3.4.5 detector program
        apriltag-3-4-5-detector = pkgs.stdenv.mkDerivation {
          pname = "apriltag-3-4-5-detector";
          version = "1.0.0";

          src = ./detectors/apriltag-3.4.5;

          nativeBuildInputs = [ pkgs.cmake ];
          buildInputs = [ apriltag-3-4-5 ];

          cmakeFlags = [
            "-Dapriltag_DIR=${apriltag-3-4-5}/lib/cmake/apriltag"
          ];

          installPhase = ''
            mkdir -p $out/bin
            cp detector $out/bin/apriltag-3-4-5-detector
          '';
        };

        # AprilTags Kaess detector program
        apriltags-kaess-detector = pkgs.stdenv.mkDerivation {
          pname = "apriltags-kaess-detector";
          version = "1.0.0";

          src = ./detectors/apriltags-kaess;

          nativeBuildInputs = [ pkgs.cmake ];
          buildInputs = [ apriltags-kaess pkgs.opencv pkgs.eigen ];

          cmakeFlags = [
            "-DAPRILTAGS_INCLUDE_DIR=${apriltags-kaess}/include"
            "-DAPRILTAGS_LIBRARY=${apriltags-kaess}/lib/libapriltags.a"
          ];

          installPhase = ''
            mkdir -p $out/bin
            cp detector $out/bin/apriltags-kaess-detector
          '';
        };

        # Script to strip EXIF data from images in data/ folder
        strip-exif = pkgs.writeShellScriptBin "strip-exif" ''
          ${pkgs.exiftool}/bin/exiftool -all= -overwrite_original -r data
        '';

        # Script to run AprilTag 3.4.5 detector on data/ folder
        run-apriltag-3-4-5 = pkgs.writeShellScriptBin "run-apriltag-3-4-5" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/apriltag-3.4.5}"

          echo "Running AprilTag 3.4.5 detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${apriltag-3-4-5-detector}/bin/apriltag-3-4-5-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run AprilTags Kaess detector on data/ folder
        run-apriltags-kaess = pkgs.writeShellScriptBin "run-apriltags-kaess" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/apriltags-kaess}"

          echo "Running AprilTags Kaess detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${apriltags-kaess-detector}/bin/apriltags-kaess-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run ground truth editor
        edit-ground-truth = pkgs.writeShellScriptBin "edit-ground-truth" ''
          echo "Starting Ground Truth Editor..."
          echo "  API Server: http://localhost:3000"
          echo "  Frontend:   http://localhost:5173"
          echo ""

          cd tools/ground-truth-editor

          # Ensure dependencies are installed
          if [ ! -d "node_modules" ]; then
            echo "Installing dependencies..."
            ${pkgs.nodejs}/bin/npm install
          fi

          # Start the API server in the background
          ${pkgs.nodejs}/bin/npm run server &
          SERVER_PID=$!

          # Cleanup function
          cleanup() {
            echo ""
            echo "Shutting down..."
            kill $SERVER_PID 2>/dev/null
            exit
          }

          trap cleanup INT TERM

          # Start Vite dev server (will run in foreground)
          ${pkgs.nodejs}/bin/npm run dev

          # Kill server when Vite exits
          cleanup
        '';

      in
      {
        packages = {
          inherit strip-exif apriltag-3-4-5 apriltag-3-4-5-detector run-apriltag-3-4-5 edit-ground-truth apriltags-kaess apriltags-kaess-detector run-apriltags-kaess;
        };

        apps = {
          strip-exif = {
            type = "app";
            program = "${strip-exif}/bin/strip-exif";
          };
          run-apriltag-3-4-5 = {
            type = "app";
            program = "${run-apriltag-3-4-5}/bin/run-apriltag-3-4-5";
          };
          run-apriltags-kaess = {
            type = "app";
            program = "${run-apriltags-kaess}/bin/run-apriltags-kaess";
          };
          edit-ground-truth = {
            type = "app";
            program = "${edit-ground-truth}/bin/edit-ground-truth";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.exiftool
            strip-exif
          ];

          shellHook = ''
            echo "AprilTag Tests Development Environment"
            echo "Available commands:"
            echo "  strip-exif                - Strip EXIF data from images in data/"
            echo "  exiftool <file>           - Inspect EXIF data"
            echo ""
            echo "Available apps (use 'nix run .#<app>'):"
            echo "  run-apriltag-3-4-5        - Run AprilTag 3.4.5 detector on data/"
            echo "  run-apriltags-kaess       - Run AprilTags Kaess detector on data/"
            echo "  edit-ground-truth         - Open ground truth annotation tool"
          '';
        };
      }
    );
}
