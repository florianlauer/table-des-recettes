#!/usr/bin/env bash
# scripts/seed-images.sh
set -euo pipefail

command -v jq >/dev/null || { echo "jq required (declared in devenv.nix)" >&2; exit 1; }

attach() {
  local slug="$1" file="$2"
  [ -f "$file" ] || { echo "Missing file: $file" >&2; exit 1; }

  # `npx convex run` authenticates as an admin: it can reach internal functions.
  local upload_url
  upload_url=$(npx convex run devImages:generateUploadUrl | jq -er '.')

  # --fail-with-body: without it, curl returns 0 on an HTTP 500 and the error body would
  # become the storage id.
  local storage_id
  storage_id=$(curl -sS --fail-with-body -X POST "$upload_url" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$file" | jq -er '.storageId')

  # From here on the blob exists. Any exit before the attach must delete it, otherwise it
  # stays in storage with no reference.
  # shellcheck disable=SC2064
  trap "npx convex run devImages:discardOrphan '{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}' >/dev/null 2>&1 || true" EXIT

  # `attach` also deletes the old file, and deletes the new one if the slug is not found.
  npx convex run devImages:attach "{\"slug\":\"$slug\",\"storageId\":\"$storage_id\"}"
  trap - EXIT
  echo "$slug ← $file"
}

attach "crepes-de-sarrasin" "docs/design/samples/crepes.jpg"
attach "gratin-dauphinois"  "docs/design/samples/gratin.jpg"
