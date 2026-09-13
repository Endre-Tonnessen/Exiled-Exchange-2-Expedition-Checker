import { execFile } from "child_process";
import { nativeImage } from "electron";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { cropImageFraction, FractionRect, ImageData } from "./utils";

export interface ExpeditionOcrResult {
  elapsed: number;
  lines: string[];
}

interface WindowsOcrLine {
  text: string;
}

interface WindowsOcrResponse {
  ok: boolean;
  error?: string;
  lines?: WindowsOcrLine[];
}

// Windows' own OCR engine (Windows.Media.Ocr - the same engine behind PowerToys'
// Text Extractor), reached via a spawned PowerShell/WinRT bridge since there's no
// Node/Electron API for it. Replaced the previous Tesseract.js/OpenCV.js pipeline
// entirely (see git history for that version, and EXPEDITION_CHECK.md for why):
// validated in ocr-playground/ against every real capture available, it read every
// item name correctly - including ones Tesseract's confidence scoring couldn't
// safely separate from icon-glyph noise - and produced zero garbage text from the
// icon glyphs themselves, at a few ms per call with no preprocessing whatsoever.
//
// No worker thread involved (unlike HeistGemFinder, which still uses one for the
// OpenCV.js/Tesseract.js WASM engine): spawning a subprocess is already
// asynchronous/non-blocking, so there's no heavy synchronous computation here to
// keep off Electron's main thread.
const SCRIPT_PATH = path.join(__dirname, "windows-ocr-recognize.ps1");

// Observed consistently across every real test capture: Windows' recognizer
// substitutes look-alike letters for the digits "1" and "0" specifically in the
// leading quantity-prefix token ("1x" -> "IX", "10x" -> "IOX"), never elsewhere in
// a line. Safe to fix with a line-start-anchored regex; a global I->1/O->0 replace
// would corrupt real item names instead (e.g. "Orb"). See ocr-playground/README.md's
// "Windows OCR (native)" section for how this was found.
function normalizeQuantityPrefix(line: string): string {
  return line.replace(
    /^([IO]+)X\b/,
    (_, digits: string) => digits.replace(/I/g, "1").replace(/O/g, "0") + "x",
  );
}

async function runPowerShell(imagePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, imagePath],
      // A hung subprocess must not be able to wedge future OCR calls for the rest
      // of the session - this runs unattended for as long as the app is open,
      // unlike the playground's short-lived dev server.
      { maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
      (err, stdout, stderr) => {
        if (stdout && stdout.trim()) {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr || String(err)));
      },
    );
  });
}

export async function ocrExpeditionPanel(
  screenshot: ImageData,
  rect: FractionRect,
): Promise<ExpeditionOcrResult> {
  const start = performance.now();
  const cropped = cropImageFraction(screenshot, rect);

  // Native screenshots are BGRA (see HeistGemFinder/the old ExpeditionOcr.ts for
  // the same assumption) - nativeImage.createFromBitmap expects exactly that on
  // little-endian systems, so no channel reordering is needed.
  const image = nativeImage.createFromBitmap(Buffer.from(cropped.data), {
    width: cropped.width,
    height: cropped.height,
  });
  const pngBuffer = image.toPNG();

  const id = crypto.randomUUID();
  const imagePath = path.join(os.tmpdir(), `ee2-winocr-${id}.png`);

  try {
    await fs.writeFile(imagePath, pngBuffer);
    const stdout = await runPowerShell(imagePath);
    const result: WindowsOcrResponse = JSON.parse(stdout);
    if (!result.ok) {
      throw new Error(result.error ?? "Unknown error from Windows OCR bridge");
    }

    // result.text (OcrResult.Text) joins every line with a space, discarding row
    // boundaries - use the per-line array instead (see ocr-playground/app.js's
    // fix for the same bug, found first there).
    const lines = (result.lines ?? [])
      .map((line) => normalizeQuantityPrefix(line.text.trim()))
      .filter((line) => line.length > 0);

    return { elapsed: performance.now() - start, lines };
  } finally {
    fs.unlink(imagePath).catch(() => {});
  }
}
