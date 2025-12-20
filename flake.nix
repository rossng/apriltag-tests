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

        # Script to strip EXIF data from images in data/ folder
        strip-exif = pkgs.writeShellScriptBin "strip-exif" ''
          ${pkgs.exiftool}/bin/exiftool -all= -overwrite_original -r data
        '';

      in
      {
        packages = {
          inherit strip-exif;
        };

        apps = {
          strip-exif = {
            type = "app";
            program = "${strip-exif}/bin/strip-exif";
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
            echo "  strip-exif       - Strip EXIF data from images in data/"
            echo "  exiftool <file>  - Inspect EXIF data"
          '';
        };
      }
    );
}
