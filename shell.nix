{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.python3
    pkgs.fish
    pkgs.postgresql
  ];

  shell = pkgs.fish;
}