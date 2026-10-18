import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { describeSnap } from "./anchoring";
import { countVideoFrames, serializePoint, summarizeReality, trackingLabel, WorldCredit } from "./diagnostics";
import { WorldSession, type WorldPhase } from "./session";
import { projectWorldPoint } from "./xr8";

/**
 * Diagnostics page for markerless anchoring: tap to pin a world point, watch the re-anchoring HUD, and preview the
 * composited (camera + pins) stream - the video the helper receives in a room.
 */
export function WorldSpike() {
  const [searchParams] = useSearchParams();
  const fake = import.meta.env.DEV && searchParams.get("fakeworld") === "1";
  const xrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<WorldSession | null>(null);
  const labelsRef = useRef(new Map<string, number>());
  const statsRef = useRef({ captureFps: 0, lastHit: "-" });

  const [phase, setPhase] = useState<WorldPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [hud, setHud] = useState<string[]>([]);
  const hudRef = useRef<string[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [showPoints, setShowPoints] = useState(false);
  const showPointsRef = useRef(false);
  showPointsRef.current = showPoints;

  const drawPins = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const session = sessionRef.current;
    const reality = session?.reality;
    if (!session || !reality) return;
    if (showPointsRef.current) {
      ctx.fillStyle = "rgba(250, 204, 21, 0.85)";
      for (const point of reality.worldPoints ?? []) {
        const at = projectWorldPoint(reality, point.position, width, height);
        if (at && at.depth > 0) ctx.fillRect(at.x - 2, at.y - 2, 4, 4);
      }
    }
    for (const point of session.tracker.points.values()) {
      const at = session.project(point.position, width, height);
      if (!at) continue;
      ctx.fillStyle = performance.now() - point.snappedAt < 600 ? "#22c55e" : "#22d3ee";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#020617";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(labelsRef.current.get(point.id) ?? "?"), at.x, at.y + 4);
      ctx.textAlign = "start";
    }
  };

  const start = () => {
    const session = new WorldSession(xrCanvasRef.current!, {
      onPhase: (next, text) => {
        setPhase(next);
        setMessage(text ?? null);
      },
      drawComposite: drawPins,
      loadEngine: fake ? () => import("./fakeXr8").then((m) => m.loadFakeXR8()) : undefined,
    });
    sessionRef.current = session;
    session.start().then(() => {
      const preview = previewRef.current;
      if (!preview || !session.stream) return;
      preview.srcObject = session.stream;
      preview.play().catch(() => undefined);
      countVideoFrames(preview, (fps) => (statsRef.current.captureFps = fps));
    });
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  // On-screen overlay: pins and the tracking-limited banner, redrawn every animation frame.
  useEffect(() => {
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const overlay = overlayRef.current;
      if (!overlay) return;
      const dpr = window.devicePixelRatio || 1;
      const width = overlay.clientWidth;
      const height = overlay.clientHeight;
      if (overlay.width !== Math.round(width * dpr)) overlay.width = Math.round(width * dpr);
      if (overlay.height !== Math.round(height * dpr)) overlay.height = Math.round(height * dpr);
      const ctx = overlay.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawPins(ctx, width, height);
      if (sessionRef.current?.reality?.trackingStatus === "LIMITED") {
        const text = "Tracking limited: more light, slower motion, aim at textured things";
        ctx.font = "600 13px system-ui, sans-serif";
        const boxWidth = Math.min(width - 24, ctx.measureText(text).width + 24);
        ctx.fillStyle = "rgba(185, 28, 28, 0.9)";
        ctx.beginPath();
        ctx.roundRect((width - boxWidth) / 2, height - 150, boxWidth, 30, 15);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, (width - boxWidth) / 2 + 12, height - 130, boxWidth - 24);
      }
    };
    render();
    return () => cancelAnimationFrame(raf);
    // drawPins reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      const reality = session?.reality ?? null;
      const s = statsRef.current;
      const p = reality?.position;
      const points = session ? [...session.tracker.points.values()] : [];
      hudRef.current = [
        `tracking ${trackingLabel(reality)}`,
        `engine ${(session?.stats.engineFps ?? 0).toFixed(1)} fps · capture ${s.captureFps.toFixed(1)} fps`,
        `camera ${p ? `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}` : "-"} · map points ${reality?.worldPoints?.length ?? 0}`,
        `pins ${points.length} · last ${s.lastHit}`,
        `vision ${(session?.stats.visionMs ?? 0).toFixed(1)} ms`,
        ...points
          .slice(-3)
          .map((point) => `pin ${labelsRef.current.get(point.id)}: anchors ${point.live}/${point.anchors.length} · ${describeSnap(point)}`),
      ];
      setHud(hudRef.current);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  // Dev-only: upload the composited frame and re-anchoring log for inspection on the laptop.
  useEffect(() => {
    if (!import.meta.env.DEV || phase !== "running") return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      fetch("/debug/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "spike",
          userAgent: navigator.userAgent,
          hud: hudRef.current,
          reality: summarizeReality(session?.reality ?? null),
          pins: session ? [...session.tracker.points.values()].map(serializePoint) : [],
          image: session?.composite?.toDataURL("image/jpeg", 0.7) ?? null,
        }),
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const onTap = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const session = sessionRef.current;
    if (!session || phase !== "running") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = crypto.randomUUID();
    const result = session.placeNormalized(id, {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
    if (!result.ok) {
      statsRef.current.lastHit = result.reason;
      return;
    }
    labelsRef.current.set(id, labelsRef.current.size + 1);
    statsRef.current.lastHit = `${result.point.method}${result.point.views.length ? "" : " · no texture to remember"}`;
  };

  return (
    <div className="spike">
      <canvas ref={xrCanvasRef} className="spike-layer" />
      <canvas ref={overlayRef} className="spike-layer" onPointerUp={onTap} />
      <video ref={previewRef} className={showPreview ? "spike-preview" : "spike-preview hidden"} muted playsInline />

      <div className="spike-hud">
        {hud.map((line) => (
          <div key={line.slice(0, 8)}>{line}</div>
        ))}
      </div>

      {phase !== "running" && (
        <div className="stage-message">
          <h1>World tracking test</h1>
          <p>Tap Start, allow camera and motion access, then slowly move the phone side to side for a few seconds.</p>
          {message && <p className="warn">{message}</p>}
          <button type="button" className="big" onClick={start} disabled={phase === "starting"}>
            {phase === "starting" ? "Starting…" : "Start"}
          </button>
          <Link to="/">Back</Link>
        </div>
      )}

      {phase === "running" && (
        <div className="spike-controls">
          {message && <span className="warn">{message}</span>}
          <button type="button" onClick={() => sessionRef.current?.tracker.clear()}>
            Clear pins
          </button>
          <button type="button" onClick={() => sessionRef.current?.recenter()}>
            Recenter
          </button>
          <button type="button" className={showPoints ? "active" : undefined} onClick={() => setShowPoints((v) => !v)}>
            {showPoints ? "Hide" : "Show"} map points
          </button>
          <button type="button" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide" : "Show"} sent video
          </button>
        </div>
      )}
      <WorldCredit className="spike-credit" />
    </div>
  );
}

