#!/usr/bin/env node
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp, { type Metadata } from "sharp";

const FORBIDDEN_METADATA_KEYS = [
  "orientation",
  "exif",
  "icc",
  "iptc",
  "xmp",
  "tifftagPhotoshop",
  "comments",
] as const;

export function retainedMetadata(metadata: Metadata): string[] {
  return FORBIDDEN_METADATA_KEYS.filter((key) => metadata[key] !== undefined);
}

export async function normalizeImage({ inputPath, outputPath }: { inputPath: string; outputPath: string }): Promise<Metadata> {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await sharp(inputPath)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb")
    .jpeg({ quality: 80 })
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  const retained = retainedMetadata(metadata);
  if (retained.length > 0) {
    throw new Error(`Métadonnées restantes dans ${outputPath} : ${retained.join(", ")}.`);
  }
  return metadata;
}

// Hors dépôt et hors iCloud : les originaux portent le GPS du domicile.
export const INBOX_DIRECTORY = resolve(homedir(), "Downloads", "table-des-recettes-inbox");

async function findInboxImage(page: string): Promise<string> {
  const inbox = INBOX_DIRECTORY;
  const stems = [page, page.toLowerCase(), page.toUpperCase()];
  const extensions = ["jpg", "jpeg", "JPG", "JPEG"];
  for (const stem of stems) {
    for (const extension of extensions) {
      const candidate = resolve(inbox, `${stem}.${extension}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Les originaux peuvent conserver la casse produite par le téléphone.
      }
    }
  }
  throw new Error(`Image ${page} introuvable dans ${inbox} (JPEG attendu).`);
}

async function main(): Promise<void> {
  const page = process.argv[2];
  if (!page || !/^[a-z][a-z0-9-prime']*$/i.test(page)) {
    throw new Error("Usage : npm run ingest -- <page> (ex. A). ");
  }
  const inputPath = await findInboxImage(page);
  const outputPath = resolve("spike/fixtures/pages", `${page.toLowerCase()}.jpg`);
  const metadata = await normalizeImage({ inputPath, outputPath });
  console.log(
    `${basename(inputPath)} → ${outputPath} (${metadata.width}×${metadata.height}, ${metadata.space}, métadonnées absentes)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
