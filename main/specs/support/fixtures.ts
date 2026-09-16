// Loading fixture captures and their ground truth.
//
// Fixtures are 24-bit BMP, not PNG, for one reason: `@wokwi/bmp-ts` is already a
// dependency of this package (HeistGemFinder decodes heist-lock.bmp with it), so
// the suite needs no image-decoding dependency of its own. They were converted
// from ocr-playground's PNGs and verified pixel-identical on 200 random pixels
// per image at conversion time.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Bmp from "@wokwi/bmp-ts";
import type { ImageData } from "../../src/vision/utils";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(HERE, "..", "fixtures");
export const IMAGES_DIR = path.join(FIXTURES_DIR, "images");
export const GROUND_TRUTH_DIR = path.join(FIXTURES_DIR, "ground-truth");

/**
 * Decodes a fixture BMP into the BGRA `ImageData` the vision layer expects.
 *
 * !! The swap below is the whole point. !! bmp-ts hands back RGBA (or ABGR with
 * its default options); `PoeWindow.screenshot()` produces BGRA, and every hue
 * threshold in rune-vision.ts is calibrated on BGRA. Feed RGBA in and red and
 * blue trade places: gold cage borders read as blue, so every cage is missed and
 * plain cells report as tiered. A fixture loader that got this wrong would make
 * the detector look broken when it isn't - or, worse, hide a real regression.
 */
export function loadFixtureImage(relPath: string): ImageData {
  const buf = fs.readFileSync(path.join(IMAGES_DIR, relPath));
  const decoded = Bmp.decode(buf, { toRGBA: true });
  const rgba = decoded.data;
  const bgra = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2]; // B
    bgra[i + 1] = rgba[i + 1]; // G
    bgra[i + 2] = rgba[i]; // R
    // 24-bit BMPs carry no alpha and bmp-ts writes 0; a real screenshot is
    // opaque, and the detector's BGRA2BGR/BGRA2GRAY conversions drop this byte
    // either way.
    bgra[i + 3] = 255;
  }
  return { width: decoded.width, height: decoded.height, data: bgra };
}

export type GroundTruthTier = "none" | "gold" | "purple" | "blue";

export interface GroundTruthCell {
  /** Omitted when the cell's border colour was never dictated - then it is not graded. */
  tier?: GroundTruthTier;
  carriesForward: boolean;
  /** Not graded by the detector suite (identity is resolved in the renderer, from text). */
  runeId?: string;
}

export interface GroundTruthRow {
  /** Not graded by the detector suite - kept for the OCR and renderer-join tests. */
  rewardText: string;
  cells: GroundTruthCell[];
}

export interface GroundTruth {
  notes: string;
  /** Where this file came from, so a disagreement can be traced back to the dictation. */
  source?: string;
  /** Path under specs/fixtures/images. */
  image: string;
  region: { x: number; y: number; width: number; height: number } | null;
  rows: GroundTruthRow[];
}

export interface LoadedGroundTruth {
  /** Path relative to the ground-truth root, "/"-separated, used as the test title. */
  name: string;
  data: GroundTruth;
}

/** Walks GROUND_TRUTH_DIR recursively so fixtures can be grouped in subfolders. */
export function loadAllGroundTruth(dir = GROUND_TRUTH_DIR, rel = ""): LoadedGroundTruth[] {
  const out: LoadedGroundTruth[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...loadAllGroundTruth(full, name));
    else if (entry.name.endsWith(".json")) {
      out.push({ name, data: JSON.parse(fs.readFileSync(full, "utf8")) as GroundTruth });
    }
  }
  return out;
}
