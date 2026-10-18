/** Minimal typings and helpers for the 8th Wall engine binary (window.XR8), served from /external/xr/. */

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { w: number; x: number; y: number; z: number };

export type HitResult = {
  type: "FEATURE_POINT" | "ESTIMATED_SURFACE" | "DETECTED_SURFACE" | "UNSPECIFIED";
  position: Vec3;
  distance: number;
};

export type WorldPoint = { id: number; confidence: number; position: Vec3 };

export type Reality = {
  rotation: Quat;
  position: Vec3;
  intrinsics: number[];
  trackingStatus: "LIMITED" | "NORMAL";
  trackingReason: string;
  worldPoints?: WorldPoint[];
};

type PipelineArgs = {
  canvas: HTMLCanvasElement;
  canvasWidth: number;
  canvasHeight: number;
  processCpuResult: { reality?: Reality };
};

export type PipelineModule = {
  name: string;
  onStart?: (args: PipelineArgs) => void;
  onCanvasSizeChange?: (args: PipelineArgs) => void;
  onUpdate?: (args: PipelineArgs) => void;
  onRender?: () => void;
  onException?: (error: unknown) => void;
  onCameraStatusChange?: (args: { status: string }) => void;
};

export type XR8Api = {
  addCameraPipelineModules(modules: PipelineModule[]): void;
  clearCameraPipelineModules(): void;
  run(config: {
    canvas: HTMLCanvasElement;
    allowedDevices?: unknown;
    cameraConfig?: { direction: unknown };
    glContextConfig?: WebGLContextAttributes;
  }): void;
  stop(): void;
  loadChunk(name: "slam"): Promise<void>;
  GlTextureRenderer: { pipelineModule(): PipelineModule };
  XrController: {
    pipelineModule(): PipelineModule;
    configure(config: { scale?: "responsive" | "absolute"; enableWorldPoints?: boolean }): void;
    /** Hit types: FEATURE_POINT is the local map; ESTIMATED_SURFACE is the floor-plane guess (wrong for desks). */
    hitTest(x: number, y: number, types: string[]): HitResult[];
    recenter(): void;
    updateCameraProjectionMatrix(config: {
      cam?: { pixelRectWidth: number; pixelRectHeight: number; nearClipPlane: number; farClipPlane: number };
      origin?: Vec3;
      facing?: Quat;
    }): void;
  };
  XrConfig: { device(): { MOBILE: unknown; ANY: unknown }; camera(): { BACK: unknown } };
};

declare global {
  interface Window {
    XR8?: XR8Api;
  }
}

let loading: Promise<XR8Api> | null = null;

export function loadXR8(): Promise<XR8Api> {
  if (!loading) {
    loading = new Promise<XR8Api>((resolve, reject) => {
      if (window.XR8) return resolve(window.XR8);
      window.addEventListener("xrloaded", () => (window.XR8 ? resolve(window.XR8) : reject(new Error("XR8 missing"))), {
        once: true,
      });
      const script = document.createElement("script");
      script.src = "/external/xr/xr.js";
      script.async = true;
      script.dataset.preloadChunks = "slam";
      script.onerror = () => reject(new Error("Could not load /external/xr/xr.js"));
      document.head.appendChild(script);
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** iOS only grants motion sensors from a user gesture; SLAM needs them. */
export async function requestMotionPermission(): Promise<string> {
  const motion = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  const orientation = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  const results = await Promise.all([
    motion.requestPermission?.().catch(() => "denied") ?? "granted",
    orientation.requestPermission?.().catch(() => "denied") ?? "granted",
  ]);
  return results.every((r) => r === "granted") ? "granted" : "denied";
}

/** Camera looks down -Z (three.js convention). Applies the inverse camera rotation to (point - position). */
export function worldToCamera(reality: Pick<Reality, "rotation" | "position">, point: Vec3): Vec3 {
  const { w } = reality.rotation;
  const u = { x: -reality.rotation.x, y: -reality.rotation.y, z: -reality.rotation.z };
  const v = { x: point.x - reality.position.x, y: point.y - reality.position.y, z: point.z - reality.position.z };
  const t = cross(u, v);
  const t2 = { x: 2 * t.x, y: 2 * t.y, z: 2 * t.z };
  const c = cross(u, t2);
  return { x: v.x + w * t2.x + c.x, y: v.y + w * t2.y + c.y, z: v.z + w * t2.z + c.z };
}

/** Inverse of worldToCamera: rotate by the camera rotation, then add its position. */
export function cameraToWorld(reality: Pick<Reality, "rotation" | "position">, point: Vec3): Vec3 {
  const { w } = reality.rotation;
  const u = { x: reality.rotation.x, y: reality.rotation.y, z: reality.rotation.z };
  const t = cross(u, point);
  const t2 = { x: 2 * t.x, y: 2 * t.y, z: 2 * t.z };
  const c = cross(u, t2);
  return {
    x: point.x + w * t2.x + c.x + reality.position.x,
    y: point.y + w * t2.y + c.y + reality.position.y,
    z: point.z + w * t2.z + c.z + reality.position.z,
  };
}

/** Canvas pixel at a given camera depth -> world point (inverse of projectWorldPoint). */
export function unproject(reality: Reality, pixel: { x: number; y: number }, depth: number, width: number, height: number): Vec3 {
  const m = reality.intrinsics;
  const ndcX = (pixel.x / width) * 2 - 1;
  const ndcY = 1 - (pixel.y / height) * 2;
  return cameraToWorld(reality, { x: ((ndcX + m[8]) / m[0]) * depth, y: ((ndcY + m[9]) / m[5]) * depth, z: -depth });
}

/** World-space direction of the camera's +X (screen right) axis. */
export function cameraRight(reality: Pick<Reality, "rotation">): Vec3 {
  return cameraToWorld({ rotation: reality.rotation, position: { x: 0, y: 0, z: 0 } }, { x: 1, y: 0, z: 0 });
}

export type DepthPick = {
  position: Vec3;
  depth: number;
  support: number;
  spread: number;
  /** "median": depth of map points right at the tap. "plane": tap ray intersected with a plane fitted to the surroundings. */
  kind: "median" | "plane";
  /** Map points the pick rests on, with the pin's offset from each, so the pin can follow map refinements. */
  anchors: Array<{ id: number; offset: Vec3 }>;
};

const MEDIAN_RADIUS_PX = 40;
const MEDIAN_MAX_SPREAD = 0.15;
const MEDIAN_MIN_SUPPORT = 5;
const PLANE_RADII_PX = [70, 110, 170];
const PLANE_MIN_POINTS = 6;
const PLANE_MIN_INLIERS = 5;

/**
 * Depth for a tap. Textured spots have map points right under the tap, so use their median depth. Plain surfaces
 * (a white desk) have few, so fit a plane to the map points around the tap and intersect the tap's ray with it -
 * a single feature point there is too noisy in depth, and depth error shows up as drift from other viewpoints.
 */
export function pickDepth(reality: Reality, tap: { x: number; y: number }, width: number, height: number): DepthPick | null {
  const median = pickByNearbyPoints(reality, tap, width, height, MEDIAN_RADIUS_PX);
  // A few points off to one side of a slanted surface have a tight depth spread but the wrong depth.
  if (median && median.support >= MEDIAN_MIN_SUPPORT && median.spread <= MEDIAN_MAX_SPREAD) return median;
  const plane = pickByLocalPlane(reality, tap, width, height);
  if (!plane) return median;
  // The points right at the tap aren't on the surrounding surface: the tap is on a small object in front of it.
  const onPlane = new Set(plane.anchors.map((anchor) => anchor.id));
  if (median && !median.anchors.some((anchor) => onPlane.has(anchor.id))) return median;
  return plane;
}

/** Camera-space ray direction (at depth 1) through a canvas pixel. */
function rayAt(reality: Reality, pixel: { x: number; y: number }, width: number, height: number) {
  const m = reality.intrinsics;
  const ndcX = (pixel.x / width) * 2 - 1;
  const ndcY = 1 - (pixel.y / height) * 2;
  return { u: (ndcX + m[8]) / m[0], v: (ndcY + m[9]) / m[5] };
}

export function pickByLocalPlane(reality: Reality, tap: { x: number; y: number }, width: number, height: number): DepthPick | null {
  const projected: Array<{ point: WorldPoint; camera: Vec3; distance: number }> = [];
  for (const point of reality.worldPoints ?? []) {
    const camera = worldToCamera(reality, point.position);
    if (camera.z >= 0) continue;
    const at = projectWorldPoint(reality, point.position, width, height);
    if (at) projected.push({ point, camera, distance: Math.hypot(at.x - tap.x, at.y - tap.y) });
  }
  const radius = PLANE_RADII_PX.find((r) => projected.filter((p) => p.distance <= r).length >= PLANE_MIN_POINTS);
  if (radius === undefined) return null;
  const nearby = projected.filter((p) => p.distance <= radius);
  const depths = nearby.map((p) => -p.camera.z).sort((a, b) => a - b);
  const medianDepth = depths[Math.floor(depths.length / 2)];
  const tolerance = Math.max(0.008, medianDepth * 0.02);

  // RANSAC over point triplets (deterministic sampling so results are reproducible).
  let best: { normal: Vec3; offset: number; inliers: typeof nearby } | null = null;
  let seed = 12345;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 80; i += 1) {
    const [a, b, c] = [0, 1, 2].map(() => nearby[Math.floor(random() * nearby.length)].camera);
    const normal = cross(sub(b, a), sub(c, a));
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-9) continue;
    const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
    const offset = n.x * a.x + n.y * a.y + n.z * a.z;
    const inliers = nearby.filter((p) => Math.abs(n.x * p.camera.x + n.y * p.camera.y + n.z * p.camera.z - offset) <= tolerance);
    if (!best || inliers.length > best.inliers.length) best = { normal: n, offset, inliers };
  }
  if (!best || best.inliers.length < PLANE_MIN_INLIERS) return null;

  // Refine: least squares depth = a*X + b*Y + c over the inliers (camera space), then intersect the tap ray.
  const fit = fitDepthPlane(best.inliers.map((p) => p.camera));
  if (!fit) return null;
  const { u, v } = rayAt(reality, tap, width, height);
  const denominator = 1 - fit.a * u - fit.b * v;
  if (Math.abs(denominator) < 1e-6) return null;
  const depth = fit.c / denominator;
  // A grazing plane or a tap far outside the fitted patch gives an implausible depth.
  if (!(depth > medianDepth * 0.5 && depth < medianDepth * 2)) return null;
  const position = cameraToWorld(reality, { x: u * depth, y: v * depth, z: -depth });
  const inlierDepths = best.inliers.map((p) => -p.camera.z).sort((x, y) => x - y);
  return {
    position,
    depth,
    support: best.inliers.length,
    spread: (inlierDepths[Math.floor(inlierDepths.length * 0.75)] - inlierDepths[Math.floor(inlierDepths.length * 0.25)]) / depth,
    kind: "plane",
    anchors: best.inliers.map((p) => ({ id: p.point.id, offset: sub(position, p.point.position) })),
  };
}

/** Least squares fit of depth = a*X + b*Y + c to camera-space points (Z = -depth). */
function fitDepthPlane(points: Vec3[]): { a: number; b: number; c: number } | null {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxd = 0, syd = 0, sd = 0;
  for (const p of points) {
    const d = -p.z;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    sx += p.x;
    syy += p.y * p.y;
    sy += p.y;
    sxd += p.x * d;
    syd += p.y * d;
    sd += d;
  }
  const n = points.length;
  // Solve [[sxx sxy sx] [sxy syy sy] [sx sy n]] [a b c]^T = [sxd syd sd]^T by Cramer's rule.
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const base = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
  const det = det3(base);
  if (Math.abs(det) < 1e-12) return null;
  const rhs = [sxd, syd, sd];
  const solve = (col: number) => det3(base.map((value, i) => (i % 3 === col ? rhs[Math.floor(i / 3)] : value))) / det;
  return { a: solve(0), b: solve(1), c: solve(2) };
}

/**
 * Place a tap on the median depth of tracked world points near it on screen, along the tap's camera ray.
 * A single feature-point hit is noisy in depth, and depth error shows up as sideways drift from other viewpoints.
 */
export function pickByNearbyPoints(
  reality: Reality,
  tap: { x: number; y: number },
  width: number,
  height: number,
  radiusPx: number,
): DepthPick | null {
  const nearby: Array<{ point: WorldPoint; depth: number }> = [];
  for (const point of reality.worldPoints ?? []) {
    const at = projectWorldPoint(reality, point.position, width, height);
    if (!at || at.depth <= 0) continue;
    if (Math.hypot(at.x - tap.x, at.y - tap.y) <= radiusPx) nearby.push({ point, depth: at.depth });
  }
  if (nearby.length < 3) return null;
  const depths = nearby.map((n) => n.depth).sort((a, b) => a - b);
  const depth = depths[Math.floor(depths.length / 2)];
  const q1 = depths[Math.floor(depths.length * 0.25)];
  const q3 = depths[Math.floor(depths.length * 0.75)];
  const position = unproject(reality, tap, depth, width, height);
  // Background points behind an object edge would drag the pin; keep the ones near the chosen depth.
  const anchors = nearby
    .filter((n) => Math.abs(n.depth - depth) <= depth * 0.15)
    .map((n) => ({ id: n.point.id, offset: sub(position, n.point.position) }));
  return { position, depth, support: nearby.length, spread: (q3 - q1) / depth, kind: "median", anchors };
}

/** Re-derive a pin from the current positions of its anchor points; null if too few are still in the map. */
export function resolveAnchoredPosition(anchors: DepthPick["anchors"], points: WorldPoint[]): { position: Vec3; live: number } | null {
  const byId = new Map(points.map((p) => [p.id, p.position]));
  const candidates: Vec3[] = [];
  for (const anchor of anchors) {
    const current = byId.get(anchor.id);
    if (current) candidates.push({ x: current.x + anchor.offset.x, y: current.y + anchor.offset.y, z: current.z + anchor.offset.z });
  }
  if (candidates.length < 2) return null;
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return {
    position: { x: median(candidates.map((c) => c.x)), y: median(candidates.map((c) => c.y)), z: median(candidates.map((c) => c.z)) },
    live: candidates.length,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** World point -> canvas pixel, using the camera pose and the column-major projection from `reality`. */
export function projectWorldPoint(reality: Reality, point: Vec3, width: number, height: number) {
  const { x: cx, y: cy, z: cz } = worldToCamera(reality, point);
  const m = reality.intrinsics;
  const clipX = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
  const clipY = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
  const clipW = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
  if (clipW <= 1e-6) return null;
  return { x: ((clipX / clipW + 1) / 2) * width, y: ((1 - clipY / clipW) / 2) * height, depth: -cz };
}
