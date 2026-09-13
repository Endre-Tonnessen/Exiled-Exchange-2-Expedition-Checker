import { parentPort } from "worker_threads";
import * as Comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import * as Bindings from "./wasm-bindings";
import { HeistGemFinder } from "./HeistGemFinder";
import { ImageData } from "./utils";

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
};
Comlink.expose(WorkerBody, nodeEndpoint(parentPort!));

export type WorkerAPI = Comlink.Remote<typeof WorkerBody>;
