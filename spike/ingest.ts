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

async function findInboxImage(stem: string): Promise<string> {
  const inbox = INBOX_DIRECTORY;
  const stems = [stem, stem.toLowerCase(), stem.toUpperCase()];
  const extensions = ["jpg", "jpeg", "JPG", "JPEG"];
  for (const candidateStem of stems) {
    for (const extension of extensions) {
      const candidate = resolve(inbox, `${candidateStem}.${extension}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Les originaux peuvent conserver la casse produite par le téléphone.
      }
    }
  }
  throw new Error(`Image ${stem} introuvable dans ${inbox} (JPEG attendu).`);
}

async function main(): Promise<void> {
  // Le second argument découple le rôle dans le protocole (A..D) du nom que tu as donné à la
  // photo : « mono1 » ou « complexe » dit quel cas la page couvre, « A » ne le dirait plus.
  const page = process.argv[2];
  if (!page || !/^[a-z][a-z0-9-]*$/i.test(page)) {
    throw new Error("Usage : npm run ingest -- <role> [source] (ex. « B duo1 », ou « A » si le fichier s'appelle déjà A).");
  }
  const inputPath = await findInboxImage(process.argv[3] ?? page);
  const outputPath = resolve("spike/fixtures/pages", `${page.toLowerCase()}.jpg`);
  const metadata = await normalizeImage({ inputPath, outputPath });
  console.log(
    `${basename(inputPath)} → ${outputPath} (${metadata.width}×${metadata.height}, ${metadata.space}, métadonnées absentes)`,
  );
  console.log("Reporte la correspondance rôle/source et le nombre réel de recettes dans spike/fixtures/pages/README.md.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
