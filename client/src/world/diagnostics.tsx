import type { TrackedPoint } from "./anchoring";
import type { Reality } from "./xr8";

/** Attribution required by the 8th Wall engine licence. */
export function WorldCredit({ className }: { className: string }) {
  return (
    <a className={className} href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noreferrer">
      Tracking by the 8th Wall engine, © Niantic Spatial
    </a>
  );
}

export function trackingLabel(reality: Reality | null) {
  if (!reality) return "-";
  return reality.trackingReason === "UNSPECIFIED" ? reality.trackingStatus : `${reality.trackingStatus} (${reality.trackingReason})`;
}

export function summarizeReality(reality: Reality | null) {
  return reality
    ? {
        trackingStatus: reality.trackingStatus,
        trackingReason: reality.trackingReason,
        position: reality.position,
        rotation: reality.rotation,
        intrinsics: reality.intrinsics,
        worldPoints: reality.worldPoints?.length ?? 0,
      }
    : null;
}

export function serializePoint({ views, ...point }: TrackedPoint) {
  return {
    ...point,
    anchors: point.anchors.map((a) => a.id),
    views: views.map((v) => ({ depth: v.depth, angle: v.angle, size: v.template.size, pixels: Array.from(v.template.data, (p) => Math.round(p)) })),
  };
}

export function countVideoFrames(video: HTMLVideoElement, onFps: (fps: number) => void) {
  const withCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  if (!withCallback.requestVideoFrameCallback) return;
  let frames = 0;
  let windowStart = performance.now();
  const tick = () => {
    frames += 1;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      onFps((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;
    }
    withCallback.requestVideoFrameCallback!(tick);
  };
  withCallback.requestVideoFrameCallback(tick);
}
