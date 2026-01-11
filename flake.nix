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

        # Helper function to create a Rust-based kornia detector
        makeKorniaDetector = { name, src, outputHash ? null, description, sourceBinary ? null }:
          let
            binaryName = if sourceBinary != null then sourceBinary else "${name}-detector";
          in
          pkgs.rustPlatform.buildRustPackage {
            pname = "${name}-detector";
            version = "1.0.0";

            inherit src;

            cargoLock = {
              lockFile = "${src}/Cargo.lock";
            } // (if outputHash != null then {
              outputHashes = {
                "kornia-apriltag-0.1.11-rc.1" = outputHash;
              };
            } else {});

            nativeBuildInputs = [ pkgs.pkg-config ];
            buildInputs = [ pkgs.libjpeg pkgs.libpng ];

            installPhase = ''
              mkdir -p $out/bin
              cp target/*/release/${binaryName} $out/bin/${name}-detector
            '';

            meta = {
              inherit description;
              homepage = "https://github.com/kornia/kornia-rs";
              license = pkgs.lib.licenses.asl20;
            };
          };

        # Helper function to create a detector runner script
        makeDetectorRunner = { name, detector, displayName, defaultOutput }:
          pkgs.writeShellScriptBin "run-${name}" ''
            INPUT_DIR="''${1:-data}"
            OUTPUT_DIR="''${2:-results/${defaultOutput}}"

            echo "Running ${displayName} detector"
            echo "  Input:  $INPUT_DIR"
            echo "  Output: $OUTPUT_DIR"
            echo ""

            ${detector}/bin/${name}-detector \
              --input "$INPUT_DIR" \
              --output "$OUTPUT_DIR"
          '';

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

        # Kornia detector program
        kornia-rs-apriltag-detector = makeKorniaDetector {
          name = "kornia-rs-apriltag";
          src = ./detectors/kornia-rs-apriltag;
          sourceBinary = "kornia-apriltag-detector";
          outputHash = "sha256-bH86Z+ihUQlomr1sSG4GzamKJMCXej1lRZFohGf1+HI=";
          description = "AprilTag detector using kornia-rs (commit 76fb225)";
        };

        # EXIF stripping utility
        strip-exif = pkgs.writeShellScriptBin "strip-exif" ''
          ${pkgs.exiftool}/bin/exiftool -all= -overwrite_original -r data
        '';

        # Detector runner scripts
        run-apriltag-3-4-5 = makeDetectorRunner {
          name = "apriltag-3-4-5";
          detector = apriltag-3-4-5-detector;
          displayName = "AprilTag 3.4.5";
          defaultOutput = "apriltag-3.4.5";
        };

        run-apriltags-kaess-3aea96d = makeDetectorRunner {
          name = "apriltags-kaess-3aea96d";
          detector = apriltags-kaess-3aea96d-detector;
          displayName = "AprilTags Kaess (3aea96d)";
          defaultOutput = "apriltags-kaess-3aea96d";
        };

        run-kornia-rs-apriltag = makeDetectorRunner {
          name = "kornia-rs-apriltag";
          detector = kornia-rs-apriltag-detector;
          displayName = "Kornia-rs AprilTag";
          defaultOutput = "kornia-rs-apriltag";
        };

        # Run all detectors in sequence
        run-all-detectors = pkgs.writeShellScriptBin "run-all-detectors" ''
          INPUT_DIR="''${1:-data}"
          RESULTS_DIR="''${2:-results}"
          ARCH_SUFFIX="''${3:-}"

          # If arch suffix is provided, append @arch to detector names
          if [ -n "$ARCH_SUFFIX" ]; then
            APRILTAG_OUTPUT="$RESULTS_DIR/apriltag-3.4.5@$ARCH_SUFFIX"
            KAESS_OUTPUT="$RESULTS_DIR/apriltags-kaess-3aea96d@$ARCH_SUFFIX"
            KORNIA_OUTPUT="$RESULTS_DIR/kornia-rs-apriltag@$ARCH_SUFFIX"
            echo "Running all detectors on $INPUT_DIR (arch: $ARCH_SUFFIX)"
          else
            APRILTAG_OUTPUT="$RESULTS_DIR/apriltag-3.4.5"
            KAESS_OUTPUT="$RESULTS_DIR/apriltags-kaess-3aea96d"
            KORNIA_OUTPUT="$RESULTS_DIR/kornia-rs-apriltag"
            echo "Running all detectors on $INPUT_DIR"
          fi
          echo "Results will be saved to $RESULTS_DIR"
          echo ""

          # Run AprilTag 3.4.5
          ${run-apriltag-3-4-5}/bin/run-apriltag-3-4-5 "$INPUT_DIR" "$APRILTAG_OUTPUT"
          echo ""

          # Run AprilTags Kaess
          ${run-apriltags-kaess-3aea96d}/bin/run-apriltags-kaess-3aea96d "$INPUT_DIR" "$KAESS_OUTPUT"
          echo ""

          # Run Kornia-rs AprilTag
          ${run-kornia-rs-apriltag}/bin/run-kornia-rs-apriltag "$INPUT_DIR" "$KORNIA_OUTPUT"
          echo ""

          echo "All detectors completed!"
        '';

        # Ground truth editor
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

        # Generate comparison report (Astro static site)
        compare-detectors = pkgs.writeShellScriptBin "compare-detectors" ''
          set -e

          GROUND_TRUTH_DIR="''${GROUND_TRUTH_DIR:-ground-truth}"
          RESULTS_DIR="''${RESULTS_DIR:-results}"
          DATA_DIR="''${DATA_DIR:-data}"
          DETECTORS="''${DETECTORS:-apriltag-3.4.5,apriltags-kaess-3aea96d,kornia-rs-apriltag}"

          echo "Building detector comparison site..."
          echo "  Ground Truth:    $GROUND_TRUTH_DIR"
          echo "  Results:         $RESULTS_DIR"
          echo "  Data:            $DATA_DIR"
          echo "  Detectors:       $DETECTORS"
          echo ""

          cd tools/compare-detectors

          # Ensure dependencies are installed
          if [ ! -d "node_modules" ]; then
            echo "Installing dependencies..."
            ${pkgs.nodejs}/bin/npm install
          fi

          # Build Astro site
          GROUND_TRUTH_DIR="../../$GROUND_TRUTH_DIR" \
          RESULTS_DIR="../../$RESULTS_DIR" \
          DETECTORS="$DETECTORS" \
          ${pkgs.nodejs}/bin/npm run build

          # Copy images to dist for visualization
          mkdir -p dist/data
          cp "../../$DATA_DIR"/*.jpg "../../$DATA_DIR"/*.png dist/data/ 2>/dev/null || true

          echo ""
          echo "Build complete! Output in tools/compare-detectors/dist/"
        '';

      in
      {
        packages = {
          inherit strip-exif apriltag-3-4-5 apriltag-3-4-5-detector run-apriltag-3-4-5 edit-ground-truth apriltags-kaess-3aea96d apriltags-kaess-3aea96d-detector run-apriltags-kaess-3aea96d kornia-rs-apriltag-detector run-kornia-rs-apriltag run-all-detectors compare-detectors;
        };

        apps = pkgs.lib.mapAttrs (name: pkg: {
          type = "app";
          program = "${pkg}/bin/${name}";
        }) {
          inherit strip-exif run-apriltag-3-4-5 run-apriltags-kaess-3aea96d run-kornia-rs-apriltag run-all-detectors edit-ground-truth compare-detectors;
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
            echo "  run-apriltags-kaess-3aea96d - Run AprilTags Kaess (3aea96d) detector on data/"
            echo "  run-kornia-rs-apriltag    - Run Kornia-rs AprilTag detector on data/"
            echo "  run-all-detectors         - Run all detectors in sequence"
            echo "  edit-ground-truth         - Open ground truth annotation tool"
            echo "  compare-detectors         - Generate comparison report vs ground truth"
          '';
        };
      }
    );
}
