import { describe, expect, test } from "vitest";
import { pickDisplayImage } from "./displayImage";

describe("pickDisplayImage", () => {
  test("la version embellie acceptée l'emporte", () => {
    expect(
      pickDisplayImage({
        imageStorageId: "orig",
        beautifiedStorageId: "beau",
        beautifiedAccepted: true,
      }),
    ).toEqual({ kind: "beautified", storageId: "beau" });
  });

  test("un candidat non accepté ne s'affiche jamais", () => {
    expect(
      pickDisplayImage({
        imageStorageId: "orig",
        beautifiedStorageId: "beau",
        beautifiedAccepted: false,
      }),
    ).toEqual({ kind: "original", storageId: "orig" });
  });

  test("originale seule", () => {
    expect(pickDisplayImage({ imageStorageId: "orig", beautifiedAccepted: false })).toEqual({
      kind: "original",
      storageId: "orig",
    });
  });

  test("aucune image", () => {
    expect(pickDisplayImage({ beautifiedAccepted: false })).toBeNull();
  });

  test("candidat accepté mais sans fichier retombe sur l'originale", () => {
    expect(pickDisplayImage({ imageStorageId: "orig", beautifiedAccepted: true })).toEqual({
      kind: "original",
      storageId: "orig",
    });
  });
});
