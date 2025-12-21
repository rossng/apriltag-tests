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
          inherit strip-exif apriltag-3-4-5 apriltag-3-4-5-detector run-apriltag-3-4-5 edit-ground-truth;
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
            echo "  edit-ground-truth         - Open ground truth annotation tool"
          '';
        };
      }
    );
}
