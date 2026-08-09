#!/usr/bin/env bash
# scripts/seed-images.sh
set -euo pipefail

command -v jq >/dev/null || { echo "jq requis (déclaré dans devenv.nix)" >&2; exit 1; }

attach() {
  local slug="$1" file="$2"
  [ -f "$file" ] || { echo "Fichier absent : $file" >&2; exit 1; }

  # `npx convex run` s'authentifie en administrateur : il atteint les fonctions internes.
  local upload_url
  upload_url=$(npx convex run devImages:generateUploadUrl | jq -er '.')

  # --fail-with-body : sans lui, curl rend 0 sur un HTTP 500 et le corps d'erreur
  # deviendrait l'identifiant de stockage.
  local storage_id
  storage_id=$(curl -sS --fail-with-body -X POST "$upload_url" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$file" | jq -er '.storageId')

  # À partir d'ici le blob existe. Toute sortie avant l'attachement doit le supprimer,
  # sinon il reste dans le stockage sans référence.
  # shellcheck disable=SC2064
  trap "npx convex run devImages:discardOrphan '{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}' >/dev/null 2>&1 || true" EXIT

  # `attach` supprime aussi l'ancien fichier, et supprime le nouveau si le slug est introuvable.
  npx convex run devImages:attach "{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}"
  trap - EXIT
  echo "$slug ← $file"
}

attach "crepes-de-sarrasin" "docs/design/samples/crepes.jpg"
attach "gratin-dauphinois"  "docs/design/samples/gratin.jpg"
