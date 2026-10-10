{ pkgs, ... }:

{
  packages = with pkgs; [
    nodejs_22
    pnpm_10
    jq
    actionlint
    yamllint
    docker
    colima
  ];
}
