import { cv } from "./wasm-bindings";

export interface ImageData {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface WeightedPoint {
  x: number;
  y: number;
  weight: number;
}

export type LinePoints = [WeightedPoint, WeightedPoint];

export function findNonZeroWeights(matchResult: any): WeightedPoint[] {
  const locations = new cv.Mat();
  cv.findNonZero(matchResult, locations);
  const weights = Array<WeightedPoint>(locations.rows);
  for (let i = 0; i < locations.rows; ++i) {
    const x = locations.intAt(i, 0);
    const y = locations.intAt(i, 1);
    const weight = matchResult.floatAt(y, x);
    weights[i] = { x, y, weight };
  }
  locations.delete();
  return weights;
}

export function groupWeightedPoints(
  weights: WeightedPoint[],
  radius: number,
): WeightedPoint[] {
  // similar to non-maximum suppression
  const maxWeighted: WeightedPoint[] = [];
  for (const point of weights) {
    const closeIdx = maxWeighted.findIndex((maxPoint) => {
      const dist = Math.hypot(point.x - maxPoint.x, point.y - maxPoint.y);
      return dist < radius;
    });
    if (closeIdx === -1) {
      maxWeighted.push(point);
    } else if (point.weight > maxWeighted[closeIdx].weight) {
      maxWeighted[closeIdx] = point;
    }
  }
  return maxWeighted;
}

export function findLines(
  points: WeightedPoint[],
  yTolerance: number,
): LinePoints[] {
  points.sort((a, b) => a.x - b.x);
  const lines: LinePoints[] = [];
  for (let idxA = 0; idxA < points.length; ++idxA) {
    for (let idxB = idxA + 1; idxB < points.length; ++idxB) {
      const pointA = points[idxA];
      const pointB = points[idxB];
      if (Math.abs(pointA.y - pointB.y) > yTolerance) continue;
      lines.push([pointA, pointB]);
      break;
    }
  }
  return lines;
}

export function hsvToU8(h: number, s: number, v: number) {
  return [
    Math.round((h * 255) / 360),
    Math.round((s * 255) / 100),
    Math.round((v * 255) / 100),
  ];
}

export function timeIt(syncFn: () => void): number {
  const startTime = performance.now();
  syncFn();
  return performance.now() - startTime;
}

export interface FractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Crops an ImageData to a rectangle given as fractions (0..1) of the image's own
// width/height, so a calibrated region stays correct across DPI changes and window
// resizes without any separate coordinate conversion. Clamped to the image bounds so a
// stale calibration (e.g. after resizing the game window) degrades to a smaller/shifted
// crop instead of throwing.
export function cropImageFraction(
  image: ImageData,
  rect: FractionRect,
): ImageData {
  const bytesPerPixel = image.data.length / (image.width * image.height);

  const x = Math.min(Math.max(Math.round(rect.x * image.width), 0), image.width - 1);
  const y = Math.min(Math.max(Math.round(rect.y * image.height), 0), image.height - 1);
  const width = Math.min(Math.round(rect.width * image.width), image.width - x);
  const height = Math.min(Math.round(rect.height * image.height), image.height - y);

  const out = new Uint8Array(Math.max(width, 0) * Math.max(height, 0) * bytesPerPixel);
  for (let row = 0; row < height; row++) {
    const srcStart = ((y + row) * image.width + x) * bytesPerPixel;
    const destStart = row * width * bytesPerPixel;
    out.set(
      image.data.subarray(srcStart, srcStart + width * bytesPerPixel),
      destStart,
    );
  }
  return { width, height, data: out };
}
