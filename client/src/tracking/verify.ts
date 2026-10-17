import type { ColorPreset, VerifyStatus } from "../../../shared/src/types";
import { VERIFY_ZONE } from "../../../shared/src/target-layout";
import type { DetectionResult } from "./detector";
import { projectPoint, type Homography } from "./homography";

type HueRange = { ranges: Array<[number, number]>; minSaturation: number; minValue: number };

export const COLOR_PRESETS: Record<ColorPreset, HueRange> = {
  blue: { ranges: [[190, 250]], minSaturation: 0.4, minValue: 0.2 },
  green: { ranges: [[85, 165]], minSaturation: 0.35, minValue: 0.2 },
  red: { ranges: [[0, 15], [340, 360]], minSaturation: 0.45, minValue: 0.25 },
  yellow: { ranges: [[40, 70]], minSaturation: 0.45, minValue: 0.35 },
};

const GRID_COLUMNS = 20;
const GRID_ROWS = 14;
const INSET = 0.12;
const ALIGNED_RATIO = 0.35;
const MIN_COVERAGE = 0.6;

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : delta / max, value: max / 255 };
}

/**
 * Samples a grid inside the printed placement zone, mapped through the homography,
 * so the check is done in target space regardless of camera angle.
 */
export function measureZone(
  detection: DetectionResult,
  homography: Homography | null,
  preset: ColorPreset,
): { status: VerifyStatus; ratio: number } {
  if (!homography) return { status: "tracking_lost", ratio: 0 };
  const { image, scaleX, scaleY } = detection;
  const range = COLOR_PRESETS[preset];
  let samples = 0;
  let hits = 0;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLUMNS; col += 1) {
      const u = INSET + ((1 - 2 * INSET) * (col + 0.5)) / GRID_COLUMNS;
      const v = INSET + ((1 - 2 * INSET) * (row + 0.5)) / GRID_ROWS;
      const p = projectPoint(homography, {
        x: VERIFY_ZONE.x + u * VERIFY_ZONE.width,
        y: VERIFY_ZONE.y + v * VERIFY_ZONE.height,
      });
      const x = Math.round(p.x / scaleX);
      const y = Math.round(p.y / scaleY);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * 4;
      const color = hsv(image.data[i], image.data[i + 1], image.data[i + 2]);
      samples += 1;
      const hueMatch = range.ranges.some(([lo, hi]) => color.hue >= lo && color.hue <= hi);
      if (hueMatch && color.saturation >= range.minSaturation && color.value >= range.minValue) hits += 1;
    }
  }

  if (samples < GRID_COLUMNS * GRID_ROWS * MIN_COVERAGE) return { status: "tracking_lost", ratio: 0 };
  const ratio = hits / samples;
  return { status: ratio >= ALIGNED_RATIO ? "aligned" : "not_yet", ratio };
}
