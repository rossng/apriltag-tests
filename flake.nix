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
        apriltags-kaess-3aea96d = pkgs.stdenv.mkDerivation {
          pname = "apriltags-kaess-3aea96d";
          version = "unstable-2024-09-21";

          src = pkgs.fetchFromBitbucket {
            owner = "kaess";
            repo = "apriltags";
            rev = "3aea96d3239bb83870cb5e0a85f142a2b0589563";
            hash = "sha256-f19R7pm0P/LFwXw4uqU6YgEediINHEAAXrkv8DG/eXg=";
          };

          nativeBuildInputs = [ pkgs.cmake pkgs.pkg-config ];
          buildInputs = [ pkgs.opencv pkgs.eigen ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.libv4l ];

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
        apriltags-kaess-3aea96d-detector = pkgs.stdenv.mkDerivation {
          pname = "apriltags-kaess-3aea96d-detector";
          version = "1.0.0";

          src = ./detectors/apriltags-kaess-3aea96d;

          nativeBuildInputs = [ pkgs.cmake ];
          buildInputs = [ apriltags-kaess-3aea96d pkgs.opencv pkgs.eigen ];

          cmakeFlags = [
            "-DAPRILTAGS_INCLUDE_DIR=${apriltags-kaess-3aea96d}/include"
            "-DAPRILTAGS_LIBRARY=${apriltags-kaess-3aea96d}/lib/libapriltags.a"
          ];

          installPhase = ''
            mkdir -p $out/bin
            cp detector $out/bin/apriltags-kaess-3aea96d-detector
          '';
        };

        # Kornia AprilTag detector program (Rust)
        kornia-apriltag-0-1-10-detector = pkgs.rustPlatform.buildRustPackage {
          pname = "kornia-apriltag-0-1-10-detector";
          version = "1.0.0";

          src = ./detectors/kornia-apriltag-0.1.10;

          cargoLock = {
            lockFile = ./detectors/kornia-apriltag-0.1.10/Cargo.lock;
          };

          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.libjpeg pkgs.libpng ];

          installPhase = ''
            mkdir -p $out/bin
            cp target/*/release/kornia-apriltag-detector $out/bin/kornia-apriltag-0-1-10-detector
          '';

          meta = {
            description = "AprilTag detector using kornia-apriltag 0.1.10";
            homepage = "https://github.com/kornia/kornia-rs";
            license = pkgs.lib.licenses.asl20;
          };
        };

        # Kornia-rs AprilTag detector program from apriltag-experiment branch
        kornia-rs-apriltag-experiment-detector = pkgs.rustPlatform.buildRustPackage {
          pname = "kornia-rs-apriltag-experiment-detector";
          version = "1.0.0";

          src = ./detectors/kornia-rs-apriltag-experiment;

          cargoLock = {
            lockFile = ./detectors/kornia-rs-apriltag-experiment/Cargo.lock;
            outputHashes = {
              "kornia-apriltag-0.1.11-rc.1" = "sha256-nNGNISNLEEgL6ltobNuMqLqoHznnfLxaywhTSSo1fKY=";
            };
          };

          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.libjpeg pkgs.libpng ];

          installPhase = ''
            mkdir -p $out/bin
            cp target/*/release/kornia-apriltag-detector $out/bin/kornia-rs-apriltag-experiment-detector
          '';

          meta = {
            description = "AprilTag detector using kornia-rs apriltag-experiment branch";
            homepage = "https://github.com/rossng/kornia-rs";
            license = pkgs.lib.licenses.asl20;
          };
        };

        # Kornia-rs AprilTag detector program from centred-coordinates branch
        kornia-rs-apriltag-centred-coordinates-detector = pkgs.rustPlatform.buildRustPackage {
          pname = "kornia-rs-apriltag-centred-coordinates-detector";
          version = "1.0.0";

          src = ./detectors/kornia-rs-apriltag-centred-coordinates;

          cargoLock = {
            lockFile = ./detectors/kornia-rs-apriltag-centred-coordinates/Cargo.lock;
            outputHashes = {
              "kornia-apriltag-0.1.11-rc.1" = "sha256-3D9vyslsmJv2UwZA2jZCDHfIRkSMjMeq9Av9pryx998=";
            };
          };

          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.libjpeg pkgs.libpng ];

          installPhase = ''
            mkdir -p $out/bin
            cp target/*/release/kornia-apriltag-centred-coordinates-detector $out/bin/kornia-rs-apriltag-centred-coordinates-detector
          '';

          meta = {
            description = "AprilTag detector using kornia-rs centred-coordinates branch";
            homepage = "https://github.com/rossng/kornia-rs";
            license = pkgs.lib.licenses.asl20;
          };
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
        run-apriltags-kaess-3aea96d = pkgs.writeShellScriptBin "run-apriltags-kaess-3aea96d" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/apriltags-kaess-3aea96d}"

          echo "Running AprilTags Kaess (3aea96d) detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${apriltags-kaess-3aea96d-detector}/bin/apriltags-kaess-3aea96d-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run Kornia AprilTag detector on data/ folder
        run-kornia-apriltag-0-1-10 = pkgs.writeShellScriptBin "run-kornia-apriltag-0-1-10" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/kornia-apriltag-0.1.10}"

          echo "Running Kornia AprilTag (0.1.10) detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${kornia-apriltag-0-1-10-detector}/bin/kornia-apriltag-0-1-10-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run Kornia-rs AprilTag detector (apriltag-experiment branch) on data/ folder
        run-kornia-rs-apriltag-experiment = pkgs.writeShellScriptBin "run-kornia-rs-apriltag-experiment" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/kornia-rs-apriltag-experiment}"

          echo "Running Kornia-rs AprilTag (apriltag-experiment) detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${kornia-rs-apriltag-experiment-detector}/bin/kornia-rs-apriltag-experiment-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run Kornia-rs AprilTag detector (centred-coordinates branch) on data/ folder
        run-kornia-rs-apriltag-centred-coordinates = pkgs.writeShellScriptBin "run-kornia-rs-apriltag-centred-coordinates" ''
          INPUT_DIR="''${1:-data}"
          OUTPUT_DIR="''${2:-results/kornia-rs-apriltag-centred-coordinates}"

          echo "Running Kornia-rs AprilTag (centred-coordinates) detector"
          echo "  Input:  $INPUT_DIR"
          echo "  Output: $OUTPUT_DIR"
          echo ""

          ${kornia-rs-apriltag-centred-coordinates-detector}/bin/kornia-rs-apriltag-centred-coordinates-detector \
            --input "$INPUT_DIR" \
            --output "$OUTPUT_DIR"
        '';

        # Script to run all detectors in sequence
        run-all-detectors = pkgs.writeShellScriptBin "run-all-detectors" ''
          INPUT_DIR="''${1:-data}"
          RESULTS_DIR="''${2:-results}"

          echo "Running all detectors on $INPUT_DIR"
          echo "Results will be saved to $RESULTS_DIR"
          echo ""

          # Run AprilTag 3.4.5
          ${run-apriltag-3-4-5}/bin/run-apriltag-3-4-5 "$INPUT_DIR" "$RESULTS_DIR/apriltag-3.4.5"
          echo ""

          # Run AprilTags Kaess
          ${run-apriltags-kaess-3aea96d}/bin/run-apriltags-kaess-3aea96d "$INPUT_DIR" "$RESULTS_DIR/apriltags-kaess-3aea96d"
          echo ""

          # Run Kornia AprilTag
          ${run-kornia-apriltag-0-1-10}/bin/run-kornia-apriltag-0-1-10 "$INPUT_DIR" "$RESULTS_DIR/kornia-apriltag-0.1.10"
          echo ""

          # Run Kornia-rs AprilTag (apriltag-experiment)
          ${run-kornia-rs-apriltag-experiment}/bin/run-kornia-rs-apriltag-experiment "$INPUT_DIR" "$RESULTS_DIR/kornia-rs-apriltag-experiment"
          echo ""

          # Run Kornia-rs AprilTag (centred-coordinates)
          ${run-kornia-rs-apriltag-centred-coordinates}/bin/run-kornia-rs-apriltag-centred-coordinates "$INPUT_DIR" "$RESULTS_DIR/kornia-rs-apriltag-centred-coordinates"
          echo ""

          echo "All detectors completed!"
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

        # Script to generate comparison report
        compare-detectors = pkgs.writeShellScriptBin "compare-detectors" ''
          set -e

          GROUND_TRUTH_DIR="''${1:-ground-truth}"
          RESULTS_DIR="''${2:-results}"
          DATA_DIR="''${3:-data}"
          OUTPUT_FILE="''${4:-comparison-report.html}"

          echo "Generating detector comparison report..."
          echo "  Ground Truth:    $GROUND_TRUTH_DIR"
          echo "  Results:         $RESULTS_DIR"
          echo "  Data:            $DATA_DIR"
          echo "  Output:          $OUTPUT_FILE"
          echo ""

          cd tools/compare-detectors

          # Ensure dependencies are installed
          if [ ! -d "node_modules" ]; then
            echo "Installing dependencies..."
            ${pkgs.nodejs}/bin/npm install
          fi

          # Build TypeScript if needed
          if [ ! -d "dist" ] || [ src/compare.ts -nt dist/compare.js ]; then
            echo "Building TypeScript..."
            ${pkgs.nodejs}/bin/npm run build
          fi

          ${pkgs.nodejs}/bin/node dist/compare.js \
            --ground-truth "../../$GROUND_TRUTH_DIR" \
            --results "../../$RESULTS_DIR" \
            --data "../../$DATA_DIR" \
            --detectors apriltag-3.4.5 apriltags-kaess-3aea96d kornia-apriltag-0.1.10 kornia-rs-apriltag-experiment kornia-rs-apriltag-centred-coordinates \
            --output "../../$OUTPUT_FILE"
        '';

      in
      {
        packages = {
          inherit strip-exif apriltag-3-4-5 apriltag-3-4-5-detector run-apriltag-3-4-5 edit-ground-truth apriltags-kaess-3aea96d apriltags-kaess-3aea96d-detector run-apriltags-kaess-3aea96d kornia-apriltag-0-1-10-detector run-kornia-apriltag-0-1-10 kornia-rs-apriltag-experiment-detector run-kornia-rs-apriltag-experiment kornia-rs-apriltag-centred-coordinates-detector run-kornia-rs-apriltag-centred-coordinates run-all-detectors compare-detectors;
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
          run-apriltags-kaess-3aea96d = {
            type = "app";
            program = "${run-apriltags-kaess-3aea96d}/bin/run-apriltags-kaess-3aea96d";
          };
          run-kornia-apriltag-0-1-10 = {
            type = "app";
            program = "${run-kornia-apriltag-0-1-10}/bin/run-kornia-apriltag-0-1-10";
          };
          run-kornia-rs-apriltag-experiment = {
            type = "app";
            program = "${run-kornia-rs-apriltag-experiment}/bin/run-kornia-rs-apriltag-experiment";
          };
          run-kornia-rs-apriltag-centred-coordinates = {
            type = "app";
            program = "${run-kornia-rs-apriltag-centred-coordinates}/bin/run-kornia-rs-apriltag-centred-coordinates";
          };
          run-all-detectors = {
            type = "app";
            program = "${run-all-detectors}/bin/run-all-detectors";
          };
          edit-ground-truth = {
            type = "app";
            program = "${edit-ground-truth}/bin/edit-ground-truth";
          };
          compare-detectors = {
            type = "app";
            program = "${compare-detectors}/bin/compare-detectors";
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
            echo "  run-apriltag-3-4-5                       - Run AprilTag 3.4.5 detector on data/"
            echo "  run-apriltags-kaess-3aea96d              - Run AprilTags Kaess (3aea96d) detector on data/"
            echo "  run-kornia-apriltag-0-1-10               - Run Kornia AprilTag (0.1.10) detector on data/"
            echo "  run-kornia-rs-apriltag-experiment        - Run Kornia-rs AprilTag (apriltag-experiment) detector on data/"
            echo "  run-kornia-rs-apriltag-centred-coordinates - Run Kornia-rs AprilTag (centred-coordinates) detector on data/"
            echo "  run-all-detectors                        - Run all detectors in sequence"
            echo "  edit-ground-truth                        - Open ground truth annotation tool"
            echo "  compare-detectors                        - Generate comparison report vs ground truth"
          '';
        };
      }
    );
}
