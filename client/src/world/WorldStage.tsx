import { useEffect, useRef, useState, type RefObject } from "react";
import type { Annotation } from "../../../shared/src/types";
import { drawArrow, drawBanner, drawLabel, drawPin, drawPointer, drawTextMarker } from "../overlay/Overlay";
import { useRoomStore } from "../state/room";
import { serializePoint, summarizeReality, WorldCredit } from "./diagnostics";
import { WorldSession, type WorldDraw, type WorldPhase } from "./session";
import type { Vec3 } from "./xr8";

type Props = {
  /** Annotations to show now (current step, guided mode). */
  annotationsRef: RefObject<Annotation[]>;
  /** Outgoing media for the helper: composited camera + annotations, plus the presenter's mic. */
  onStream: (stream: MediaStream | null) => void;
  onPhase: (phase: WorldPhase) => void;
  onUseSheet: () => void;
  fake: boolean;
  debug: boolean;
};

const POINTER_FADE_MS = 1000;
const STATUS_INTERVAL_MS = 1000;
/** Points nobody references (e.g. an arrow start the helper abandoned) are dropped after this long. */
const ORPHAN_TTL_MS = 60_000;
const PENDING_ACTIVE_MS = 30_000;

/** Presenter's camera view in world tracking mode. */
export function WorldStage({ annotationsRef, onStream, onPhase, onUseSheet, fake, debug }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<WorldSession | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<WorldPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [unplaceable, setUnplaceable] = useState(0);
  const callbacks = useRef({ onStream, onPhase });
  callbacks.current = { onStream, onPhase };

  const drawAnnotations: WorldDraw = (ctx, _width, _height, project) => {
    const session = sessionRef.current;
    if (!session) return;
    const at = (id: string | undefined) => {
      const point = id ? session.tracker.points.get(id) : undefined;
      return point ? project(point.position) : null;
    };
    for (const annotation of annotationsRef.current ?? []) {
      if (!annotation.world) continue;
      const start = at(annotation.world.start);
      if (!start) continue;
      if (annotation.type === "arrow") {
        const end = at(annotation.world.end);
        if (end) drawArrow(ctx, start, end);
      } else if (annotation.type === "pin") {
        drawPin(ctx, start);
      } else {
        drawTextMarker(ctx, start);
      }
      if (annotation.text) drawLabel(ctx, annotation.text, start);
    }
  };
  const drawRef = useRef(drawAnnotations);
  drawRef.current = drawAnnotations;

  const start = async () => {
    sessionRef.current?.stop();
    const session = new WorldSession(canvasRef.current!, {
      onPhase: (next, text) => {
        setPhase(next);
        setMessage(text ?? null);
        callbacks.current.onPhase(next);
      },
      drawComposite: (...args) => drawRef.current(...args),
      loadEngine: fake ? () => import("./fakeXr8").then((m) => m.loadFakeXR8()) : undefined,
      tagFrames: true,
      beforeEngine: async () => {
        if (micRef.current) return;
        micRef.current = await navigator.mediaDevices
          .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
          .catch(() => null);
      },
    });
    sessionRef.current = session;
    session.isActive = (id) => {
      const point = session.tracker.points.get(id);
      if (point && performance.now() - point.createdAt < PENDING_ACTIVE_MS) return true;
      return (annotationsRef.current ?? []).some((a) => a.world?.start === id || a.world?.end === id);
    };
    await session.start();
    if (sessionRef.current !== session || !session.stream) return;
    const tracks = [...session.stream.getVideoTracks(), ...(micRef.current?.getAudioTracks() ?? [])];
    callbacks.current.onStream(new MediaStream(tracks));
  };

  // Answer helpers' taps with tracked points.
  useEffect(() => {
    const store = useRoomStore.getState();
    store.setWorldResolver(({ point, frame }) => {
      const session = sessionRef.current;
      if (!session) return { ok: false, reason: "World tracking isn't running on the presenter's phone." };
      const result = session.placeNormalized(crypto.randomUUID(), point, frame);
      return result.ok ? { ok: true, id: result.point.id } : result;
    });
    return () => store.setWorldResolver(null);
  }, []);

  useEffect(
    () => () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
      micRef.current?.getTracks().forEach((track) => track.stop());
      micRef.current = null;
      callbacks.current.onStream(null);
    },
    [],
  );

  // Presenter's screen: annotations plus the helper's laser, which is not burned into the outgoing video.
  useEffect(() => {
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const overlay = overlayRef.current;
      const session = sessionRef.current;
      if (!overlay) return;
      const dpr = window.devicePixelRatio || 1;
      const width = overlay.clientWidth;
      const height = overlay.clientHeight;
      if (overlay.width !== Math.round(width * dpr)) overlay.width = Math.round(width * dpr);
      if (overlay.height !== Math.round(height * dpr)) overlay.height = Math.round(height * dpr);
      const ctx = overlay.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!session?.reality) return;
      drawRef.current(ctx, width, height, (point: Vec3) => session.project(point, width, height));
      const pointer = useRoomStore.getState().pointer;
      const age = pointer ? Date.now() - pointer.ts : Infinity;
      if (pointer?.position && pointer.space === "video" && age < POINTER_FADE_MS) {
        drawPointer(ctx, { x: pointer.position.x * width, y: pointer.position.y * height }, 1 - age / POINTER_FADE_MS);
      }
      if (session.reality.trackingStatus === "LIMITED") {
        drawBanner(ctx, width, "Tracking limited - more light, move slowly, aim at textured things", "rgba(185, 28, 28, 0.9)");
      }
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Share tracking health with the helper, prune abandoned points, and count annotations from an earlier session.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const store = useRoomStore.getState();
      const session = sessionRef.current;
      const reality = session?.reality;
      store.sendWorldStatus({
        status: !session ? "off" : !reality ? "starting" : reality.trackingStatus === "LIMITED" ? "limited" : "normal",
        ts: Date.now(),
      });
      if (!session) return;
      const all = store.state?.annotations ?? [];
      const referenced = new Set(all.flatMap((a) => (a.world ? [a.world.start, a.world.end ?? ""] : [])));
      const now = performance.now();
      session.tracker.remove((point) => !referenced.has(point.id) && now - point.createdAt > ORPHAN_TTL_MS);
      const missing = (annotationsRef.current ?? []).filter((a) => a.world && !session.tracker.points.has(a.world.start)).length;
      setUnplaceable((current) => (current === missing ? current : missing));
    }, STATUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [annotationsRef]);

  // Dev-only: with debug on, upload the outgoing frame and re-anchoring state for inspection on the laptop.
  useEffect(() => {
    if (!import.meta.env.DEV || !debug) return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      fetch("/debug/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "presenter",
          userAgent: navigator.userAgent,
          tracking: "world",
          stats: session?.stats ?? null,
          reality: summarizeReality(session?.reality ?? null),
          points: session ? [...session.tracker.points.values()].map(serializePoint) : [],
          annotations: useRoomStore.getState().state?.annotations ?? [],
          image: session?.composite?.toDataURL("image/jpeg", 0.7) ?? null,
        }),
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [debug]);

  return (
    <>
      <canvas ref={canvasRef} className="world-layer" />
      <canvas ref={overlayRef} className="world-layer" />
      {phase !== "running" && (
        <div className="stage-message">
          <p>
            Tap Start, allow camera, microphone and motion access, then slowly move the phone around the object for a few
            seconds so it can map the scene.
          </p>
          {message && <p className="warn">{message}</p>}
          <button type="button" className="big" onClick={() => void start()} disabled={phase === "starting"}>
            {phase === "starting" ? "Starting…" : "Start camera"}
          </button>
          <button type="button" className="ghost" onClick={onUseSheet}>
            Use the printed sheet instead
          </button>
        </div>
      )}
      {phase === "running" && unplaceable > 0 && (
        <div className="world-note">
          {unplaceable} annotation{unplaceable === 1 ? " was" : "s were"} placed before tracking restarted and can't be
          shown. Ask the helper to place {unplaceable === 1 ? "it" : "them"} again.
        </div>
      )}
      <WorldCredit className="world-credit" />
    </>
  );
}
