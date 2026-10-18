import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { BOARD, TEST_DOT, VERIFY_ZONE } from "../../../shared/src/target-layout";
import type { Annotation, PointerState, Vec2, VerifyStatus } from "../../../shared/src/types";
import { useRoomStore } from "../state/room";
import { computeVideoBox, videoToCanvasPoint, type VideoBox } from "../tracking/coords";
import type { Homography } from "../tracking/homography";
import type { TrackingStatus } from "../tracking/tracker";

export type OverlayView = {
  homography: Homography | null;
  status: TrackingStatus;
  usingFallback: boolean;
  markers: Array<{ id: number; corners: Vec2[] }>;
  info?: TrackingInfo;
};

export type TrackingInfo = {
  videoSize: string;
  frameSize: string;
  detectMs: number;
  fps: number;
  error: string | null;
};

type OverlayProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  viewRef: RefObject<OverlayView>;
  annotationsRef: RefObject<Annotation[]>;
  localPointerRef: RefObject<PointerState | null>;
  pendingArrowRef: RefObject<Vec2 | null>;
  verifyStatusRef: RefObject<VerifyStatus | null>;
  mirrored: boolean;
  debug: boolean;
  showGuidance: boolean;
  showVerifyZone: boolean;
  /**
   * World tracking: annotations are burned into the presenter's video, so this overlay only draws the helper's own
   * laser and pending arrow start (in normalised video coordinates) and skips sheet-tracking banners.
   */
  world?: boolean;
  onPointerDown?: (point: Vec2) => void;
  onPointerMove?: (point: Vec2) => void;
  onPointerUp?: (point: Vec2) => void;
};

const POINTER_FADE_MS = 1000;
const ACCENT = "#22d3ee";
const VERIFY_COLORS: Record<VerifyStatus, string> = {
  aligned: "#22c55e",
  not_yet: "#f59e0b",
  tracking_lost: "#94a3b8",
};

function project(h: Homography, p: Vec2): Vec2 | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (w <= 1e-6) return null;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, at: Vec2) {
  ctx.font = "600 15px system-ui, sans-serif";
  const width = ctx.measureText(text).width + 16;
  const x = at.x + 14;
  const y = at.y - 32;
  ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, 26, 6);
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(text, x + 8, y + 18);
}

export function drawPin(ctx: CanvasRenderingContext2D, at: Vec2, color = ACCENT) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawArrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 18;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - Math.cos(angle) * head * 0.6, to.y - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - 0.45), to.y - head * Math.sin(angle - 0.45));
  ctx.lineTo(to.x - head * Math.cos(angle + 0.45), to.y - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

export function drawTextMarker(ctx: CanvasRenderingContext2D, at: Vec2) {
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPointer(ctx: CanvasRenderingContext2D, at: Vec2, alpha: number) {
  ctx.fillStyle = `rgba(239, 68, 68, ${0.35 * alpha})`;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 8, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPendingStart(ctx: CanvasRenderingContext2D, at: Vec2) {
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(at.x, at.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawBanner(ctx: CanvasRenderingContext2D, width: number, text: string, color: string) {
  ctx.font = "600 15px system-ui, sans-serif";
  const textWidth = ctx.measureText(text).width;
  const boxWidth = Math.min(width - 24, textWidth + 28);
  const x = (width - boxWidth) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, 12, boxWidth, 34, 17);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 14, 34, boxWidth - 28);
}

export function Overlay(props: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const render = () => {
      raf = requestAnimationFrame(render);
      const p = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const video = p.videoRef.current;
      if (!video?.videoWidth) return;
      const videoWidth = video.videoWidth;
      const box: VideoBox = computeVideoBox(cssWidth, cssHeight, videoWidth, video.videoHeight);
      const toCanvas = (videoPoint: Vec2) => videoToCanvasPoint(videoPoint, box, p.mirrored, videoWidth);
      const view = p.viewRef.current;
      const h = view.homography;
      const mmToCanvas = (mm: Vec2) => {
        if (!h) return null;
        const videoPoint = project(h, mm);
        return videoPoint ? toCanvas(videoPoint) : null;
      };
      const normToCanvas = (n: Vec2) => toCanvas({ x: n.x * videoWidth, y: n.y * video.videoHeight });

      if (p.debug) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        for (const marker of view.markers) {
          const pts = marker.corners.map(toCanvas);
          ctx.beginPath();
          pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = "#facc15";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.fillText(String(marker.id), pts[0].x + 4, pts[0].y - 4);
        }
        const outline = [
          { x: 0, y: 0 },
          { x: BOARD.width, y: 0 },
          { x: BOARD.width, y: BOARD.height },
          { x: 0, y: BOARD.height },
        ].map(mmToCanvas);
        if (outline.every(Boolean)) {
          ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
          ctx.beginPath();
          outline.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt!.x, pt!.y) : ctx.lineTo(pt!.x, pt!.y)));
          ctx.closePath();
          ctx.stroke();
        }
        const dot = mmToCanvas(TEST_DOT);
        if (dot) {
          ctx.strokeStyle = "#e11d48";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 12, 0, Math.PI * 2);
          ctx.stroke();
        }
        const info = view.info;
        const lines = [
          `status ${view.status}${view.usingFallback ? " (presenter pose)" : ""}`,
          `markers [${view.markers.map((m) => m.id).join(",")}]`,
          info ? `video ${info.videoSize} · detect ${info.frameSize}` : "detector not running",
          info ? `${info.fps.toFixed(1)} fps · ${info.detectMs.toFixed(0)} ms` : "",
          info?.error ? `error: ${info.error}` : "",
        ].filter(Boolean);
        ctx.font = "600 12px ui-monospace, monospace";
        ctx.fillStyle = "rgba(2, 6, 23, 0.75)";
        ctx.fillRect(8, cssHeight - 12 - lines.length * 16, 280, lines.length * 16 + 6);
        ctx.fillStyle = "#facc15";
        lines.forEach((line, i) => ctx.fillText(line, 14, cssHeight - 12 - (lines.length - 1 - i) * 16 - 2, 268));
      }

      if (p.showVerifyZone && h) {
        const zone = [
          { x: VERIFY_ZONE.x, y: VERIFY_ZONE.y },
          { x: VERIFY_ZONE.x + VERIFY_ZONE.width, y: VERIFY_ZONE.y },
          { x: VERIFY_ZONE.x + VERIFY_ZONE.width, y: VERIFY_ZONE.y + VERIFY_ZONE.height },
          { x: VERIFY_ZONE.x, y: VERIFY_ZONE.y + VERIFY_ZONE.height },
        ].map(mmToCanvas);
        if (zone.every(Boolean)) {
          ctx.strokeStyle = VERIFY_COLORS[p.verifyStatusRef.current ?? "tracking_lost"];
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 6]);
          ctx.beginPath();
          zone.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt!.x, pt!.y) : ctx.lineTo(pt!.x, pt!.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (p.world) {
        const pending = p.pendingArrowRef.current;
        if (p.showGuidance && pending) drawPendingStart(ctx, normToCanvas(pending));
      }

      if (!p.world && p.showGuidance && h) {
        for (const annotation of p.annotationsRef.current) {
          if (annotation.world) continue;
          const start = mmToCanvas(annotation.start);
          if (!start) continue;
          if (annotation.type === "arrow" && annotation.end) {
            const end = mmToCanvas(annotation.end);
            if (end) drawArrow(ctx, start, end);
            if (end && annotation.text) drawLabel(ctx, annotation.text, start);
            continue;
          }
          if (annotation.type === "pin") drawPin(ctx, start);
          if (annotation.type === "text") drawTextMarker(ctx, start);
          if (annotation.text) drawLabel(ctx, annotation.text, start);
        }
        const pending = p.pendingArrowRef.current;
        const pendingAt = pending ? mmToCanvas(pending) : null;
        if (pendingAt) drawPendingStart(ctx, pendingAt);
      }

      if (p.showGuidance) {
        const now = Date.now();
        const pointers = [p.localPointerRef.current, useRoomStore.getState().pointer];
        for (const pointer of pointers) {
          if (!pointer?.position) continue;
          const age = now - pointer.ts;
          if (age > POINTER_FADE_MS) continue;
          const at = pointer.space === "target" ? mmToCanvas(pointer.position) : normToCanvas(pointer.position);
          if (!at) continue;
          drawPointer(ctx, at, 1 - age / POINTER_FADE_MS);
        }
      }

      if (p.world) return;
      if (view.status === "lost") {
        drawBanner(ctx, cssWidth, "Target lost - point the camera at the printed target", "rgba(185, 28, 28, 0.9)");
      } else if (view.usingFallback) {
        drawBanner(ctx, cssWidth, "Using presenter's tracking", "rgba(30, 64, 175, 0.85)");
      }
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, []);

  const toPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className="overlay"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        props.onPointerDown?.(toPoint(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons) props.onPointerMove?.(toPoint(event));
      }}
      onPointerUp={(event) => props.onPointerUp?.(toPoint(event))}
      onPointerCancel={(event) => props.onPointerUp?.(toPoint(event))}
    />
  );
}
