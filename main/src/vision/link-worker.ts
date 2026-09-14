import { parentPort } from "worker_threads";
import * as Comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import * as Bindings from "./wasm-bindings";
import { HeistGemFinder } from "./HeistGemFinder";
import { ImageData, FractionRect } from "./utils";
import { detectExpeditionRunes } from "./expedition-runes/RuneDetector";

let _heistGems: HeistGemFinder;
let _changeLangPromise = Promise.resolve();

// Expedition Price Check's OCR (WindowsOcr.ts) is NOT here - unlike Heist gem
// finding, it doesn't use the OpenCV.js/Tesseract.js WASM engine this worker
// thread exists to isolate, so it's called directly from link-main.ts instead of
// round-tripping through this worker for no benefit.
const WorkerBody = {
  async init(binDir: string) {
    await Bindings.init(binDir);
    _heistGems = await HeistGemFinder.create(binDir);
  },
  async changeLanguage(lang: string, binDir: string) {
    await _changeLangPromise;
    _changeLangPromise = Bindings.changeLanguage(lang, binDir);
    await _changeLangPromise;
  },
  async findHeistGems(screenshot: ImageData) {
    await _changeLangPromise;
    return _heistGems.ocrScreenshot(screenshot);
  },
  // Expedition RUNE detection does belong here, unlike the reward-text OCR
  // above it: it uses the OpenCV.js build this worker owns. Running it on the
  // worker thread is also what lets it overlap with the Windows OCR subprocess
  // instead of queueing behind it, so enabling rune tracking cannot slow the
  // existing reward pricing down.
  //
  // No `await _changeLangPromise` - that gate exists for Tesseract's language
  // data, which nothing here touches.
  async detectExpeditionRunes(screenshot: ImageData, rect: FractionRect) {
    return detectExpeditionRunes(screenshot, rect);
  },
};
Comlink.expose(WorkerBody, nodeEndpoint(parentPort!));

export type WorkerAPI = Comlink.Remote<typeof WorkerBody>;
