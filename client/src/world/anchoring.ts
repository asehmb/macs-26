import { buildPyramid, makeTemplate, matchAcrossScales, type GrayImage, type ScaledMatch, type Template } from "./patch";
import {
  cameraRight,
  pickDepth,
  projectWorldPoint,
  resolveAnchoredPosition,
  unproject,
  type DepthPick,
  type HitResult,
  type Reality,
  type Vec3,
} from "./xr8";

export type PatchView = { template: Template; depth: number; angle: number };

export type SnapAttempt = {
  t: number;
  status: string;
  view: number;
  score: number | null;
  margin: number | null;
  shift: number | null;
  predictedScale: number;
  matchedScale: number | null;
  angle: number;
};

/** A world point placed by a tap, kept in place by nearby map points and by re-finding its image patch. */
export type TrackedPoint = {
  id: string;
  createdAt: number;
  position: Vec3;
  method: string;
  anchors: DepthPick["anchors"];
  live: number;
  /**
   * Patches of the surroundings, from placement and from later confident matches at noticeably different
   * distances/rolls, so a big move is matched against the most similar view rather than the original.
   */
  views: PatchView[];
  /** World-space reference direction whose projection gives each view's on-screen rotation. */
  refOffset: Vec3;
  lastScore: number | null;
  lastShift: number;
  snappedAt: number;
  pendingCorrection: { x: number; y: number } | null;
  status: string;
  attempts: SnapAttempt[];
};

export type Vision = { width: number; height: number; grab: () => GrayImage | null };

const SNAP_RADIUS_PX = 60;
const SNAP_MIN_SCORE = 0.8;
const SNAP_MIN_MARGIN = 0.1;
/** Two consecutive matches must agree on the correction, or a look-alike patch could capture the point. */
const SNAP_AGREE_PX = 4;
const SNAP_BLEND = 0.6;
const VIEW_MIN_SCORE = 0.85;
const VIEW_MIN_MARGIN = 0.15;
const VIEW_SCALE_STEP = 1.35;
const VIEW_ANGLE_STEP = 0.4;
const MAX_VIEWS = 8;
const EDGE_MARGIN_PX = 30;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type PlaceResult = { ok: true; point: TrackedPoint } | { ok: false; reason: string };

export class PointTracker {
  readonly points = new Map<string, TrackedPoint>();
  private cursor = 0;

  constructor(private vision: Vision) {}

  /**
   * Place a point under a tap given in view pixels (`width` x `height`, the same frame `reality` projects into).
   * `seen` is the tracking state of the frame the tap was made on, when that was an earlier frame (a remote tap
   * arrives after the video delay); depth is picked there, the image patch from the current frame.
   * `hitTest` is the engine's fallback (current frame only) when too few map points are near the tap.
   */
  place(
    id: string,
    reality: Reality,
    tap: { x: number; y: number },
    width: number,
    height: number,
    source: { seen?: Reality; hitTest: (x: number, y: number) => HitResult | undefined },
    now = performance.now(),
  ): PlaceResult {
    const fromSeen = source.seen ? pickDepth(source.seen, tap, width, height) : null;
    const picked = fromSeen ?? pickDepth(reality, tap, width, height);
    let position: Vec3;
    let method: string;
    let anchors: DepthPick["anchors"] = [];
    if (picked) {
      position = picked.position;
      anchors = picked.anchors;
      method = `${picked.kind} of ${picked.support} pts, spread ${(picked.spread * 100).toFixed(0)}%, ${fromSeen ? "seen frame" : "current frame"}`;
    } else {
      const hit = source.hitTest(tap.x / width, tap.y / height);
      if (!hit) return { ok: false, reason: "That spot isn't mapped yet - ask the presenter to move the phone slowly around it." };
      position = hit.position;
      method = `single point at ${hit.distance.toFixed(2)}`;
    }
    const point: TrackedPoint = {
      id,
      createdAt: now,
      position,
      method,
      anchors,
      live: anchors.length,
      views: [],
      refOffset: { x: 0, y: 0, z: 0 },
      lastScore: null,
      lastShift: 0,
      snappedAt: 0,
      pendingCorrection: null,
      status: "placed",
      attempts: [],
    };
    const gray = this.vision.grab();
    if (gray) {
      const depth = projectWorldPoint(reality, position, this.vision.width, this.vision.height)?.depth ?? 0;
      const right = cameraRight(reality);
      point.refOffset = { x: right.x * depth * 0.05, y: right.y * depth * 0.05, z: right.z * depth * 0.05 };
      const view = this.view(reality, point);
      const template = view && view.length > 2 ? makeTemplate(gray, view.at.x, view.at.y, view.angle) : null;
      if (view && template) point.views = [{ template, depth: view.at.depth, angle: view.angle }];
    }
    this.points.set(id, point);
    return { ok: true, point };
  }

  /** Every frame: follow refinements of the map points each point rests on. */
  follow(reality: Reality) {
    const worldPoints = reality.worldPoints ?? [];
    for (const point of this.points.values()) {
      const resolved = point.anchors.length ? resolveAnchoredPosition(point.anchors, worldPoints) : null;
      point.live = resolved?.live ?? 0;
      if (resolved) point.position = resolved.position;
    }
  }

  /** One point per call, round-robin, to keep the per-frame cost bounded. `active` limits which points are worth snapping. */
  snapNext(reality: Reality, now: number, active: (point: TrackedPoint) => boolean = () => true) {
    const candidates = [...this.points.values()].filter((point) => point.views.length && active(point));
    if (!candidates.length) return;
    this.snap(candidates[this.cursor++ % candidates.length], reality, now);
  }

  remove(predicate: (point: TrackedPoint) => boolean) {
    for (const [id, point] of this.points) if (predicate(point)) this.points.delete(id);
  }

  clear() {
    this.points.clear();
  }

  /** Where a point and its reference direction land in the vision image right now. */
  private view(reality: Reality, point: Pick<TrackedPoint, "position" | "refOffset">) {
    const { width, height } = this.vision;
    const at = projectWorldPoint(reality, point.position, width, height);
    const ref = projectWorldPoint(
      reality,
      { x: point.position.x + point.refOffset.x, y: point.position.y + point.refOffset.y, z: point.position.z + point.refOffset.z },
      width,
      height,
    );
    if (!at || !ref || at.depth <= 0 || ref.depth <= 0) return null;
    return { at, length: Math.hypot(ref.x - at.x, ref.y - at.y), angle: Math.atan2(ref.y - at.y, ref.x - at.x) };
  }

  private snap(point: TrackedPoint, reality: Reality, now: number) {
    const { width, height } = this.vision;
    const view = this.view(reality, point);
    if (!view) {
      point.status = "behind camera";
      return;
    }
    if (view.at.x < EDGE_MARGIN_PX || view.at.y < EDGE_MARGIN_PX || view.at.x > width - EDGE_MARGIN_PX || view.at.y > height - EDGE_MARGIN_PX) {
      point.status = "off screen";
      return;
    }
    // Apparent size scales with 1/distance; this stays valid when the surface is seen obliquely.
    const cost = (v: PatchView) => Math.abs(Math.log(v.depth / view.at.depth)) + 0.5 * Math.abs(wrapAngle(view.angle - v.angle));
    const viewIndex = point.views.reduce((best, v, i) => (cost(v) < cost(point.views[best]) ? i : best), 0);
    const patch = point.views[viewIndex];
    const scale = patch.depth / view.at.depth;
    const angle = view.angle - patch.angle;
    const record = (status: string, match: ScaledMatch | null) => {
      point.status = status;
      point.attempts.push({
        t: Math.round(now),
        status,
        view: viewIndex,
        score: match?.score ?? null,
        margin: match?.margin ?? null,
        shift: match?.shift ?? null,
        predictedScale: scale,
        matchedScale: match?.scale ?? null,
        angle,
      });
      if (point.attempts.length > 40) point.attempts.shift();
    };
    if (scale < 0.3 || scale > 3.5) return record(`scale ${scale.toFixed(2)} out of range`, null);
    const gray = this.vision.grab();
    if (!gray) return record("no camera frame", null);
    const match = matchAcrossScales(buildPyramid(gray), patch.template, view.at.x, view.at.y, angle, scale, SNAP_RADIUS_PX);
    point.lastScore = match?.score ?? null;
    if (!match) {
      point.pendingCorrection = null;
      return record("no peak", null);
    }
    if (match.score < SNAP_MIN_SCORE || match.margin < SNAP_MIN_MARGIN) {
      point.pendingCorrection = null;
      return record(match.score < SNAP_MIN_SCORE ? "weak" : "ambiguous", match);
    }
    const correction = { x: match.x - view.at.x, y: match.y - view.at.y };
    const previous = point.pendingCorrection;
    point.pendingCorrection = correction;
    if (match.shift > 1.5 && (!previous || Math.hypot(correction.x - previous.x, correction.y - previous.y) > SNAP_AGREE_PX)) {
      return record("confirming", match);
    }
    record("snapped", match);
    point.lastShift = match.shift;
    point.snappedAt = now;
    point.pendingCorrection = { x: correction.x * (1 - SNAP_BLEND), y: correction.y * (1 - SNAP_BLEND) };
    const corrected = unproject(reality, match, view.at.depth, width, height);
    point.position = {
      x: point.position.x + (corrected.x - point.position.x) * SNAP_BLEND,
      y: point.position.y + (corrected.y - point.position.y) * SNAP_BLEND,
      z: point.position.z + (corrected.z - point.position.z) * SNAP_BLEND,
    };
    // Re-anchor to the map as it is now, so the correction persists between snaps.
    const byId = new Map((reality.worldPoints ?? []).map((p) => [p.id, p.position]));
    point.anchors = point.anchors.map((anchor) => {
      const current = byId.get(anchor.id);
      return current
        ? { id: anchor.id, offset: { x: point.position.x - current.x, y: point.position.y - current.y, z: point.position.z - current.z } }
        : anchor;
    });
    // Remember this view too if it is confidently the same spot but looks different from every stored view.
    if (match.score < VIEW_MIN_SCORE || match.margin < VIEW_MIN_MARGIN) return;
    const relScale = (v: PatchView) => Math.abs(Math.log(v.depth / view.at.depth));
    const novel = point.views.every((v) => relScale(v) > Math.log(VIEW_SCALE_STEP) || Math.abs(wrapAngle(view.angle - v.angle)) > VIEW_ANGLE_STEP);
    if (!novel) return;
    const template = makeTemplate(gray, match.x, match.y, view.angle);
    if (!template) return;
    // Keep the placement view forever; replace the oldest learned one when full.
    if (point.views.length >= MAX_VIEWS) point.views.splice(1, 1);
    point.views.push({ template, depth: view.at.depth, angle: view.angle });
    point.status = `learned view ${point.views.length}`;
  }
}

export function describeSnap(point: TrackedPoint): string {
  if (!point.views.length) return "no patch (plain surface)";
  const last = point.attempts[point.attempts.length - 1];
  const numbers = last?.score != null ? ` ${last.score.toFixed(2)}/${last.margin!.toFixed(2)}` : "";
  const status = last && point.status === last.status ? `${last.status}${numbers}` : point.status;
  const recent = point.attempts.slice(-20);
  const snapped = recent.filter((a) => a.status === "snapped").length;
  return `${status} · ${snapped}/${recent.length} snapped · ${point.views.length} views${
    performance.now() - point.snappedAt < 1500 ? ` (moved ${point.lastShift.toFixed(0)}px)` : ""
  }`;
}
