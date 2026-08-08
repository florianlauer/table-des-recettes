{ pkgs, ... }:

{
  packages = with pkgs; [
    nodejs_22
    actionlint
    yamllint
    docker
    colima
  ];
}
