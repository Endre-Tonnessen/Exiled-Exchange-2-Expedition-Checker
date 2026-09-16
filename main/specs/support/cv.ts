// OpenCV bootstrap for the pixel tests.
//
// Two things here are not obvious and cost an afternoon each if rediscovered:
//
// 1. `opencv.js` is NOT in this repository. The app downloads it at runtime into
//    the user's data directory (see link-main.ts's `binDir`). So these tests go
//    looking for that download and skip cleanly when it isn't there - a machine
//    that has never run the app tells you nothing about the detector, and a
//    failure there would be noise.
//
// 2. It must be loaded as CommonJS, via createRequire - NOT with `import()`.
//    wasm-bindings.ts uses `await import("file://" + ...)`, which works in the
//    shipped app only because esbuild bundles that worker to CJS and rewrites
//    the call to `require()`. Under a real ESM loader the same file throws:
//    its UMD tail does a bare `Module = {}` (a ReferenceError in strict mode),
//    and the emscripten body underneath calls `require("fs")` and reads
//    `__filename`, neither of which exists in an ES module. createRequire gives
//    it the CJS environment it actually needs, which is also the environment it
//    gets in production.

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

/**
 * The directory the app downloads its OpenCV/Tesseract WASM builds into, or null
 * if it isn't there. `EE2_CV_BIN_DIR` overrides, for a machine that keeps it
 * somewhere else.
 */
export function findCvBinDir(): string | null {
  const candidates: string[] = [];
  if (process.env.EE2_CV_BIN_DIR) candidates.push(process.env.EE2_CV_BIN_DIR);
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "exiled-exchange-2", "apt-data", "cv-ocr"));
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "opencv.js"))) return dir;
  }
  return null;
}

let loading: Promise<any> | null = null;

/**
 * The real OpenCV build the app itself uses - not a stub. `opencv.js`'s
 * module.exports is the emscripten ready-promise, so this resolves to the cv
 * namespace once the WASM is instantiated. Cached: instantiating it twice in one
 * process is slow and pointless.
 */
export function loadRealCv(binDir: string): Promise<any> {
  loading ??= Promise.resolve(requireCjs(path.join(binDir, "opencv.js")));
  return loading;
}
