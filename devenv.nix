{ pkgs, ... }:

{
  packages = with pkgs; [
    nodejs_22
    jq
    actionlint
    yamllint
    docker
    colima
  ];
}
