import { Worker } from "worker_threads";
import * as Comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import type { WorkerAPI } from "./link-worker";
import type { FractionRect, ImageData } from "./utils";
import * as WindowsOcr from "./WindowsOcr";
import { app } from "electron";
import path from "path";

export class OcrWorker {
  private binDir = path.join(app.getPath("userData"), "apt-data/cv-ocr");
  private api: Comlink.Remote<WorkerAPI>;
  private lang = "";

  private constructor() {
    const worker = new Worker(path.join(__dirname, "vision.js"));
    this.api = Comlink.wrap<WorkerAPI>(nodeEndpoint(worker));
  }

  static async create() {
    const worker = new OcrWorker();
    try {
      await worker.api.init(worker.binDir);
    } catch {}
    return worker;
  }

  async updateOptions(lang: string) {
    try {
      if (lang !== this.lang) {
        await this.api.changeLanguage(lang, this.binDir);
      }
    } catch {
    } finally {
      this.lang = lang;
    }
  }

  async findHeistGems(image: ImageData) {
    const result = await this.api.findHeistGems(
      Comlink.transfer(image, [image.data.buffer]),
    );
    return result;
  }

  // Not routed through the worker/Comlink (unlike findHeistGems above) - see the
  // comment in link-worker.ts for why: this doesn't touch the WASM engine that
  // worker exists to isolate, so there's nothing to gain from the round-trip.
  async ocrExpeditionPanel(image: ImageData, rect: FractionRect) {
    return await WindowsOcr.ocrExpeditionPanel(image, rect);
  }
}
