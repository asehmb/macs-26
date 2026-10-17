import type { MarkerDetection } from "./detector";
import { PointFilter } from "./filter";
import { computeHomography, invertHomography, projectPoint, type Homography } from "./homography";

const MARKER_MM = 35;
const BOARD_W_MM = 210;
const BOARD_H_MM = 297;

const markerOrigins: Record<number, { x: number; y: number }> = {
  10: { x: 10, y: 10 },
  11: { x: BOARD_W_MM - MARKER_MM - 10, y: 10 },
  12: { x: BOARD_W_MM - MARKER_MM - 10, y: BOARD_H_MM - MARKER_MM - 10 },
  13: { x: 10, y: BOARD_H_MM - MARKER_MM - 10 },
  20: { x: BOARD_W_MM / 2 - MARKER_MM / 2, y: BOARD_H_MM / 2 - MARKER_MM / 2 }, // reference
};

const markerCornerOffsets = [
  { x: 0, y: 0 },
  { x: MARKER_MM, y: 0 },
  { x: MARKER_MM, y: MARKER_MM },
  { x: 0, y: MARKER_MM },
];

export type TrackingResult = {
  homography: Homography | null;
  inverse: Homography | null;
  status: "ok" | "lost";
  referenceErrorPx: number | null;
  markerCount: number;
};

const smoothers = new Map<string, PointFilter>();

function filterPoint(key: string, point: { x: number; y: number }) {
  const filter = smoothers.get(key) ?? new PointFilter();
  smoothers.set(key, filter);
  return filter.apply(point);
}

export function clearTrackingFilters() {
  smoothers.clear();
}

export function computeTracking(markers: MarkerDetection[]): TrackingResult {
  const source: Array<{ x: number; y: number }> = [];
  const target: Array<{ x: number; y: number }> = [];
  let referenceErrorPx: number | null = null;

  for (const marker of markers) {
    const origin = markerOrigins[marker.id];
    if (!origin) continue;
    for (let i = 0; i < Math.min(4, marker.corners.length); i += 1) {
      if (marker.id !== 20) {
        source.push(filterPoint(`${marker.id}-${i}`, marker.corners[i]));
        target.push({
          x: origin.x + markerCornerOffsets[i].x,
          y: origin.y + markerCornerOffsets[i].y,
        });
      }
    }
  }

  if (source.length < 4) {
    return { homography: null, inverse: null, status: "lost", referenceErrorPx: null, markerCount: markers.length };
  }

  const h = computeHomography(target.slice(0, 4), source.slice(0, 4));
  if (!h) {
    return { homography: null, inverse: null, status: "lost", referenceErrorPx: null, markerCount: markers.length };
  }
  const inv = invertHomography(h);

  const refMarker = markers.find((marker) => marker.id === 20 && marker.corners.length >= 4);
  if (refMarker) {
    const expected = projectPoint(h, {
      x: markerOrigins[20].x + MARKER_MM / 2,
      y: markerOrigins[20].y + MARKER_MM / 2,
    });
    const detected = refMarker.corners.reduce(
      (acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }),
      { x: 0, y: 0 },
    );
    referenceErrorPx = Math.hypot(expected.x - detected.x, expected.y - detected.y);
  }

  return { homography: h, inverse: inv, status: "ok", referenceErrorPx, markerCount: markers.length };
}

export const BOARD_SIZE_MM = { width: BOARD_W_MM, height: BOARD_H_MM };
