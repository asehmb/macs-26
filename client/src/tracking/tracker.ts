import {
  MARKER_BY_ID,
  REFERENCE_MARKER_ID,
  markerCenterMm,
  markerCornersMm,
} from "../../../shared/src/target-layout";
import { OneEuroFilter } from "./filter";
import {
  computeHomography,
  invertHomography,
  projectPoint,
  reprojectionRms,
  type Homography,
  type Point,
} from "./homography";

export type MarkerDetection = {
  id: number;
  corners: Point[];
};

export type TrackingStatus = "ok" | "holding" | "lost";

export type TrackingFrame = {
  status: TrackingStatus;
  /** Maps target millimetres to video pixels. */
  homography: Homography | null;
  inverse: Homography | null;
  markers: MarkerDetection[];
  usedMarkerIds: number[];
  reprojectionPx: number | null;
  reference: { errorPx: number; errorMm: number } | null;
  time: number;
};

const LOST_AFTER_MS = 300;
const FILTER_STALE_MS = 300;
const MAX_REPROJECTION_PX = 6;

type CornerFilter = { x: OneEuroFilter; y: OneEuroFilter; lastSeen: number };

type Fit = { homography: Homography; rms: number; ids: number[] };

function averagePoint(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export class TargetTracker {
  private filters = new Map<string, CornerFilter>();
  private lastGood: { homography: Homography; inverse: Homography; time: number } | null = null;

  reset() {
    this.filters.clear();
    this.lastGood = null;
  }

  update(detections: MarkerDetection[], time: number): TrackingFrame {
    const known = detections.filter((marker) => MARKER_BY_ID.has(marker.id) && marker.corners.length === 4);
    const corners = known.filter((marker) => MARKER_BY_ID.get(marker.id)?.role === "corner");
    const anchors = corners.length > 0 ? corners : known;
    const fit = this.fit(anchors, time);

    if (fit) {
      const inverse = invertHomography(fit.homography);
      if (inverse) {
        this.lastGood = { homography: fit.homography, inverse, time };
        return {
          status: "ok",
          homography: fit.homography,
          inverse,
          markers: detections,
          usedMarkerIds: fit.ids,
          reprojectionPx: fit.rms,
          reference: this.measureReference(known, fit.homography, inverse, anchors),
          time,
        };
      }
    }

    const holding = this.lastGood && time - this.lastGood.time < LOST_AFTER_MS;
    return {
      status: holding ? "holding" : "lost",
      homography: holding ? this.lastGood!.homography : null,
      inverse: holding ? this.lastGood!.inverse : null,
      markers: detections,
      usedMarkerIds: [],
      reprojectionPx: null,
      reference: null,
      time,
    };
  }

  private smoothed(markerId: number, index: number, point: Point, time: number): Point {
    const key = `${markerId}:${index}`;
    let filter = this.filters.get(key);
    if (!filter || time - filter.lastSeen > FILTER_STALE_MS) {
      filter = { x: new OneEuroFilter(), y: new OneEuroFilter(), lastSeen: time };
      this.filters.set(key, filter);
    }
    filter.lastSeen = time;
    return { x: filter.x.filter(point.x, time), y: filter.y.filter(point.y, time) };
  }

  private fit(markers: MarkerDetection[], time: number): Fit | null {
    if (markers.length === 0) return null;
    const groups = markers.map((marker) => {
      const spec = MARKER_BY_ID.get(marker.id)!;
      return {
        id: marker.id,
        mm: markerCornersMm(spec),
        px: marker.corners.map((corner, index) => this.smoothed(marker.id, index, corner, time)),
      };
    });

    const solve = (subset: typeof groups): Fit | null => {
      const mm = subset.flatMap((group) => group.mm);
      const px = subset.flatMap((group) => group.px);
      const homography = computeHomography(mm, px);
      if (!homography) return null;
      return { homography, rms: reprojectionRms(homography, mm, px), ids: subset.map((g) => g.id) };
    };

    let best = solve(groups);
    if (best && best.rms > MAX_REPROJECTION_PX && groups.length > 1) {
      for (let skip = 0; skip < groups.length; skip += 1) {
        const candidate = solve(groups.filter((_, index) => index !== skip));
        if (candidate && candidate.rms < best.rms) best = candidate;
      }
    }
    if (!best || best.rms > MAX_REPROJECTION_PX * 2) return null;
    return best;
  }

  private measureReference(
    markers: MarkerDetection[],
    homography: Homography,
    inverse: Homography,
    anchors: MarkerDetection[],
  ) {
    const reference = markers.find((marker) => marker.id === REFERENCE_MARKER_ID);
    if (!reference || anchors.includes(reference)) return null;
    const spec = MARKER_BY_ID.get(REFERENCE_MARKER_ID)!;
    const expectedMm = markerCenterMm(spec);
    const detectedPx = averagePoint(reference.corners);
    const expectedPx = projectPoint(homography, expectedMm);
    const detectedMm = projectPoint(inverse, detectedPx);
    return {
      errorPx: Math.hypot(expectedPx.x - detectedPx.x, expectedPx.y - detectedPx.y),
      errorMm: Math.hypot(expectedMm.x - detectedMm.x, expectedMm.y - detectedMm.y),
    };
  }
}
