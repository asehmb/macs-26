import { useEffect, useRef, type PointerEvent } from "react";
import type { Annotation, PointerState } from "../../../shared/src/types";
import { computeVideoBox, videoToCanvasPoint } from "../tracking/coords";
import { projectPoint, type Homography } from "../tracking/homography";

type OverlayProps = {
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  mirrored: boolean;
  homography: Homography | null;
  annotations: Annotation[];
  pointer: PointerState;
  trackingLost: boolean;
  onTap?: (point: { x: number; y: number }) => void;
  onHoldPointer?: (point: { x: number; y: number } | null) => void;
};

export function Overlay({
  width,
  height,
  videoWidth,
  videoHeight,
  mirrored,
  homography,
  annotations,
  pointer,
  trackingLost,
  onTap,
  onHoldPointer,
}: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const box = computeVideoBox(width, height, Math.max(videoWidth, 1), Math.max(videoHeight, 1));

    if (trackingLost) {
      ctx.fillStyle = "rgba(180, 0, 0, 0.75)";
      ctx.fillRect(12, 12, 144, 34);
      ctx.fillStyle = "#fff";
      ctx.font = "600 14px sans-serif";
      ctx.fillText("Target lost", 24, 34);
    }

    for (const annotation of annotations) {
      if (!homography) continue;
      const startVideo = projectPoint(homography, annotation.start);
      const start = videoToCanvasPoint(startVideo, box, mirrored, videoWidth);
      const end = annotation.end
        ? videoToCanvasPoint(projectPoint(homography, annotation.end), box, mirrored, videoWidth)
        : null;

      ctx.strokeStyle = "#2dd4bf";
      ctx.fillStyle = "#2dd4bf";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
      ctx.fill();
      if (annotation.type === "arrow" && end) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      if (annotation.text) {
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.fillRect(start.x + 10, start.y - 24, Math.max(100, annotation.text.length * 8), 24);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "13px sans-serif";
        ctx.fillText(annotation.text, start.x + 14, start.y - 8);
      }
    }

    if (pointer.position && homography && Date.now() - pointer.ts < 1000) {
      const pointerVideo = projectPoint(homography, pointer.position);
      const p = videoToCanvasPoint(pointerVideo, box, mirrored, videoWidth);
      ctx.fillStyle = "rgba(248,113,113,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [annotations, height, homography, mirrored, pointer, trackingLost, videoHeight, videoWidth, width]);

  const toCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className="overlay"
      onPointerUp={(event) => {
        onTap?.(toCanvasPoint(event));
        onHoldPointer?.(null);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHoldPointer?.(toCanvasPoint(event));
      }}
      onPointerMove={(event) => {
        if (event.buttons) {
          onHoldPointer?.(toCanvasPoint(event));
        }
      }}
      onPointerCancel={() => onHoldPointer?.(null)}
    />
  );
}
