import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import type { Annotation, PointerState, Role, Vec2, VerifyStatus } from "../../../shared/src/types";
import { useCamera } from "../camera/useCamera";
import { BenchPanel } from "../components/BenchPanel";
import { HelperTools, type Tool } from "../components/HelperTools";
import { StepsPanel } from "../components/StepsPanel";
import { VerifyPanel } from "../components/VerifyPanel";
import { Overlay } from "../overlay/Overlay";
import { HelperLink, PresenterLink } from "../rtc/peer";
import { StatsRecorder } from "../state/bench";
import { useRoomStore } from "../state/room";
import { canvasToVideoPoint, computeVideoBox } from "../tracking/coords";
import type { DetectionResult } from "../tracking/detector";
import { invertHomography, projectPoint, scaleHomography } from "../tracking/homography";
import type { TrackingFrame } from "../tracking/tracker";
import { useTracking } from "../tracking/useTracking";
import { measureZone } from "../tracking/verify";
import { readTag } from "../world/frameTag";
import type { WorldPhase } from "../world/session";
import { WorldStage } from "../world/WorldStage";

type LinkState = RTCPeerConnectionState | "idle";

const TAP_SLOP_PX = 12;
const POINTER_INTERVAL_MS = 33;
const POSE_INTERVAL_MS = 100;
const VERIFY_INTERVAL_MS = 250;

const TRACKING_LABEL = {
  loading: "Loading tracker",
  error: "Tracker failed",
  ok: "Target tracked",
  holding: "Target tracked",
  lost: "Target lost",
} as const;

const WORLD_PHASE_LABEL: Record<WorldPhase, string> = {
  idle: "World tracking off",
  starting: "World tracking starting",
  running: "World tracking",
  error: "World tracking failed",
};

const WORLD_STATUS_MAX_AGE_MS = 3000;

function linkLabel(state: LinkState) {
  if (state === "connected") return "Video connected";
  if (state === "connecting" || state === "new") return "Connecting video";
  if (state === "failed") return "Video failed - retrying";
  if (state === "disconnected") return "Video interrupted";
  return "No video link";
}

export function Room() {
  const { code = "" } = useParams();
  const [searchParams] = useSearchParams();
  const role: Role = searchParams.get("role") === "presenter" ? "presenter" : "helper";
  const roomCode = code.toUpperCase();

  const connected = useRoomStore((s) => s.connected);
  const state = useRoomStore((s) => s.state);
  const peers = useRoomStore((s) => s.peers);
  const selfId = useRoomStore((s) => s.selfId);

  const synthetic = searchParams.get("synthetic") === "1";
  const fakeWorld = import.meta.env.DEV && searchParams.get("fakeworld") === "1";
  const camera = useCamera({ synthetic });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pipRef = useRef<HTMLVideoElement | null>(null);
  const selfViewRef = useRef<HTMLVideoElement | null>(null);
  const presenterLinkRef = useRef<PresenterLink | null>(null);
  const helperLinkRef = useRef<HelperLink | null>(null);
  const recorder = useMemo(() => new StatsRecorder(), []);

  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteAudio, setRemoteAudio] = useState<MediaStream | null>(null);
  const [needsSoundTap, setNeedsSoundTap] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [helperCamStream, setHelperCamStream] = useState<MediaStream | null>(null);
  const [remoteHelperVideo, setRemoteHelperVideo] = useState<MediaStream | null>(null);
  const [worldStream, setWorldStream] = useState<MediaStream | null>(null);
  const [worldPhase, setWorldPhase] = useState<WorldPhase>("idle");
  const [debug, setDebug] = useState(false);
  const [showZone, setShowZone] = useState(true);
  const [tool, setTool] = useState<Tool>("pin");
  const [draftText, setDraftText] = useState("");
  const [arrowPending, setArrowPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [localVerify, setLocalVerify] = useState<{ status: VerifyStatus; ratio: number } | null>(null);

  const annotationsRef = useRef<Annotation[]>([]);
  const localPointerRef = useRef<PointerState | null>(null);
  const pendingArrowRef = useRef<Vec2 | null>(null);
  const pendingWorldRef = useRef<string | null>(null);
  const verifyStatusRef = useRef<VerifyStatus | null>(null);
  const pointerDownRef = useRef<Vec2 | null>(null);
  const lastPointerSentRef = useRef(0);
  const lastPoseSentRef = useRef(0);
  const lastVerifyRef = useRef(0);
  const seenAnnotationsRef = useRef<Set<string> | null>(null);
  const tapLogRef = useRef<string[]>([]);
  const logTap = (entry: string) => {
    tapLogRef.current = [...tapLogRef.current.slice(-9), `${new Date().toISOString().slice(11, 23)} ${entry}`];
  };

  const presenter = peers.find((peer) => peer.role === "presenter" && peer.id !== selfId) ?? null;
  const helper = [...peers].reverse().find((peer) => peer.role === "helper" && peer.id !== selfId) ?? null;
  const partnerPresent = role === "presenter" ? Boolean(helper) : Boolean(presenter);
  const guided = state?.mode !== "baseline";
  const world = state ? state.tracking === "world" : null;
  const presenterWorld = role === "presenter" && world === true;
  const mirrored = role === "presenter" && !presenterWorld && camera.facingMode === "user";
  const outgoing = presenterWorld ? worldStream : camera.stream;
  const worldStatus = useRoomStore((s) => s.worldStatus);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2500);
  }, []);

  // Room connection: depends only on the room identity, never on store contents.
  useEffect(() => {
    useRoomStore.getState().connect(roomCode, role);
    return () => useRoomStore.getState().disconnect();
  }, [roomCode, role]);

  // The synthetic test camera (and ?tracking=sheet) can only be tracked with the printed sheet.
  const askedForSheetRef = useRef(false);
  useEffect(() => {
    if (role !== "presenter" || !state || askedForSheetRef.current) return;
    askedForSheetRef.current = true;
    if ((synthetic || searchParams.get("tracking") === "sheet") && state.tracking !== "sheet") {
      useRoomStore.getState().setTracking("sheet");
    }
  }, [role, state, synthetic, searchParams]);

  // Sheet mode uses the plain camera; world mode hands the camera to the tracking engine (started by a tap).
  useEffect(() => {
    if (role !== "presenter" || world === null) return;
    if (world) camera.stop();
    else camera.start();
    // camera.start/stop are stable; react to the tracking mode only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, world]);

  // WebRTC links, one per role, fed by the signalling channel.
  useEffect(() => {
    const { sendSignal, onSignal } = useRoomStore.getState();
    if (role === "presenter") {
      const link = new PresenterLink(sendSignal, setLinkState, setRemoteAudio, setRemoteHelperVideo);
      presenterLinkRef.current = link;
      const off = onSignal((from, data) => void link.handleSignal(from, data).catch(console.warn));
      return () => {
        off();
        link.close();
        presenterLinkRef.current = null;
      };
    }
    const link = new HelperLink(sendSignal, setLinkState, setRemoteStream);
    helperLinkRef.current = link;
    const off = onSignal((from, data) => void link.handleSignal(from, data).catch(console.warn));
    return () => {
      off();
      link.close();
      helperLinkRef.current = null;
    };
  }, [role]);

  useEffect(() => {
    presenterLinkRef.current?.setStream(outgoing);
  }, [outgoing]);

  useEffect(() => {
    const link = presenterLinkRef.current;
    if (role !== "presenter" || !link) return;
    if (!helper) {
      if (link.peerId) link.close();
      return;
    }
    if (outgoing && link.peerId !== helper.id) {
      link.setStream(outgoing);
      link.connectTo(helper.id).catch(console.warn);
    }
  }, [role, helper?.id, outgoing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    helperLinkRef.current?.setMicTrack(micStream?.getAudioTracks()[0] ?? null);
  }, [micStream]);

  useEffect(() => () => micStream?.getTracks().forEach((track) => track.stop()), [micStream]);

  useEffect(() => {
    helperLinkRef.current?.setCameraTrack(helperCamStream?.getVideoTracks()[0] ?? null);
    if (selfViewRef.current) selfViewRef.current.srcObject = helperCamStream;
    if (role === "helper") useRoomStore.getState().setHelperCamera(Boolean(helperCamStream));
  }, [helperCamStream, role]);

  useEffect(() => () => helperCamStream?.getTracks().forEach((track) => track.stop()), [helperCamStream]);

  // The helper's webcam, picture-in-picture on the presenter's screen.
  const showHelperPip = role === "presenter" && Boolean(state?.helperCamera && remoteHelperVideo);
  useEffect(() => {
    const pip = pipRef.current;
    if (!pip) return;
    if (pip.srcObject !== remoteHelperVideo) pip.srcObject = remoteHelperVideo;
    if (remoteHelperVideo) pip.play().catch(() => undefined);
  }, [remoteHelperVideo, showHelperPip]);

  // Media elements.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const source = role === "presenter" ? camera.stream : remoteStream;
    if (video.srcObject !== source) video.srcObject = source;
    if (!source) return;
    video.muted = role === "presenter";
    video.play().catch(() => {
      // Autoplay with sound was blocked; play muted and ask for a tap.
      video.muted = true;
      video.play().catch(() => undefined);
      if (role === "helper") setNeedsSoundTap(true);
    });
  }, [role, camera.stream, remoteStream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = remoteAudio;
    if (remoteAudio) audio.play().catch(() => setNeedsSoundTap(true));
  }, [remoteAudio]);

  const enableSound = () => {
    const video = videoRef.current;
    if (role === "helper" && video) {
      video.muted = false;
      video.play().catch(() => undefined);
    }
    audioRef.current?.play().catch(() => undefined);
    setNeedsSoundTap(false);
  };

  const toggleHelperCamera = async () => {
    if (helperCamStream) {
      setHelperCamStream(null);
      return;
    }
    try {
      setMicError(null);
      setHelperCamStream(
        await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        }),
      );
    } catch {
      setMicError("Camera permission was denied.");
    }
  };

  const toggleMic = async () => {
    if (micStream) {
      setMicStream(null);
      return;
    }
    try {
      setMicError(null);
      setMicStream(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    } catch {
      setMicError("Microphone permission was denied.");
    }
  };

  // Visible annotations follow the current step and the baseline/guided condition.
  const visibleAnnotations = useMemo(() => {
    if (!state || state.mode === "baseline") return [];
    return state.annotations.filter((a) => !a.stepId || a.stepId === state.currentStepId);
  }, [state]);
  annotationsRef.current = visibleAnnotations;

  useEffect(() => {
    if (!state) return;
    const seen = seenAnnotationsRef.current;
    if (!seen) {
      seenAnnotationsRef.current = new Set(state.annotations.map((a) => a.id));
      return;
    }
    const now = useRoomStore.getState().serverNow();
    for (const annotation of state.annotations) {
      if (seen.has(annotation.id)) continue;
      seen.add(annotation.id);
      if (annotation.creatorId !== selfId) recorder.recordLatency(Math.max(0, now - annotation.createdAt));
    }
  }, [state, selfId, recorder]);

  // Per-frame work outside React: pose broadcast, verification, and bench stats.
  const onFrame = useCallback(
    (detection: DetectionResult, frame: TrackingFrame) => {
      recorder.recordFrame(frame.time, detection.elapsedMs, frame.status === "lost", frame.reference);
      if (role !== "presenter") return;
      const video = videoRef.current;
      const now = performance.now();
      const store = useRoomStore.getState();

      if (video && now - lastPoseSentRef.current > POSE_INTERVAL_MS) {
        lastPoseSentRef.current = now;
        store.sendPoseFallback({
          homography: frame.homography ? scaleHomography(frame.homography, 1 / video.videoWidth, 1 / video.videoHeight) : null,
          ts: Date.now(),
        });
      }

      if (now - lastVerifyRef.current > VERIFY_INTERVAL_MS) {
        lastVerifyRef.current = now;
        const result = measureZone(detection, frame.homography, store.state?.verifyColor ?? "blue");
        verifyStatusRef.current = result.status;
        setLocalVerify((prev) =>
          prev && prev.status === result.status && Math.abs(prev.ratio - result.ratio) < 0.02 ? prev : result,
        );
        store.sendVerifyReport({ ...result, ts: Date.now() });
      }
    },
    [role, recorder],
  );

  const tracking = useTracking({ videoRef, useFallbackPose: role === "helper", enabled: world === false, onFrame });
  const { snapshot, viewRef: trackingViewRef } = tracking;

  // Dev-only: with debug on, upload what the detector sees so it can be inspected on the laptop.
  useEffect(() => {
    if (!import.meta.env.DEV || !debug || presenterWorld) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const view = trackingViewRef.current;
      const body = {
        role,
        userAgent: navigator.userAgent,
        status: view.status,
        usingFallback: view.usingFallback,
        markers: view.markers.map((m) => ({ id: m.id, corners: m.corners.map((c) => [Math.round(c.x), Math.round(c.y)]) })),
        info: view.info ?? null,
        video: video
          ? { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, paused: video.paused }
          : null,
        stage: video?.parentElement ? [video.parentElement.clientWidth, video.parentElement.clientHeight] : null,
        mode: useRoomStore.getState().state?.mode ?? null,
        annotations: useRoomStore.getState().state?.annotations.length ?? 0,
        taps: tapLogRef.current,
        image: world ? videoFrame(video) : snapshot(),
      };
      fetch("/debug/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
        () => undefined,
      );
    }, 2000);
    return () => window.clearInterval(timer);
  }, [debug, role, snapshot, trackingViewRef, presenterWorld, world]);

  useEffect(() => {
    if (role !== "helper") return;
    const timer = window.setInterval(() => {
      const report = useRoomStore.getState().verifyReport;
      verifyStatusRef.current = report && Date.now() - report.ts < 3000 ? report.status : null;
    }, 250);
    return () => window.clearInterval(timer);
  }, [role]);

  // Canvas point -> video pixel -> target millimetres.
  const locate = (point: Vec2) => {
    const video = videoRef.current;
    const canvas = video?.parentElement;
    if (!video?.videoWidth || !canvas) return null;
    const box = computeVideoBox(canvas.clientWidth, canvas.clientHeight, video.videoWidth, video.videoHeight);
    const videoPoint = canvasToVideoPoint(point, box, mirrored, video.videoWidth);
    const normalized = { x: videoPoint.x / video.videoWidth, y: videoPoint.y / video.videoHeight };
    const inside = normalized.x >= 0 && normalized.x <= 1 && normalized.y >= 0 && normalized.y <= 1;
    const h = tracking.viewRef.current.homography;
    const inverse = h ? invertHomography(h) : null;
    return { target: inverse ? projectPoint(inverse, videoPoint) : null, normalized: inside ? normalized : null };
  };

  const sendPointer = (point: Vec2 | null, force = false) => {
    const now = performance.now();
    if (!force && now - lastPointerSentRef.current < POINTER_INTERVAL_MS) return;
    lastPointerSentRef.current = now;
    let pointer: PointerState = { position: null, space: "target", ts: Date.now() };
    if (point) {
      const located = locate(point);
      if (located?.target) pointer = { position: located.target, space: "target", ts: Date.now() };
      else if (located?.normalized) pointer = { position: located.normalized, space: "video", ts: Date.now() };
    }
    localPointerRef.current = pointer;
    useRoomStore.getState().sendPointer(pointer);
  };

  /** World mode: the presenter's phone resolves the tap into a tracked 3D point and draws it into its video. */
  const placeWorldAnnotation = async (point: Vec2) => {
    const located = locate(point);
    const text = draftText.trim();
    if (!located?.normalized) {
      showToast("Tap on the video.");
      return;
    }
    if (tool === "text" && !text) {
      showToast("Type the instruction first, then tap where it goes.");
      return;
    }
    const frame = videoRef.current ? readTag(videoRef.current) : null;
    const store = useRoomStore.getState();
    const result = await store.resolveWorldPoint({ point: located.normalized, frame });
    logTap(
      `world ${tool} at ${located.normalized.x.toFixed(3)},${located.normalized.y.toFixed(3)} frame ${frame ?? "?"} -> ${result.ok ? result.id : result.reason}`,
    );
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    if (tool === "arrow" && !pendingWorldRef.current) {
      pendingWorldRef.current = result.id;
      pendingArrowRef.current = located.normalized;
      setArrowPending(true);
      return;
    }
    const now = store.serverNow();
    const arrow = tool === "arrow";
    store.addAnnotation({
      id: uuid(),
      type: tool === "laser" ? "pin" : tool,
      creatorId: selfId ?? "unknown",
      text: text || undefined,
      stepId: store.state?.currentStepId ?? undefined,
      createdAt: now,
      updatedAt: now,
      start: arrow ? pendingArrowRef.current! : located.normalized,
      end: arrow ? located.normalized : undefined,
      world: { start: arrow ? pendingWorldRef.current! : result.id, end: arrow ? result.id : undefined },
    });
    pendingWorldRef.current = null;
    pendingArrowRef.current = null;
    setArrowPending(false);
    setDraftText("");
  };

  const placeAnnotation = (point: Vec2) => {
    if (world) {
      void placeWorldAnnotation(point);
      return;
    }
    const located = locate(point);
    logTap(
      `place ${tool} at ${point.x.toFixed(0)},${point.y.toFixed(0)} -> ${
        located?.target ? `${located.target.x.toFixed(1)},${located.target.y.toFixed(1)} mm` : "no target"
      }`,
    );
    if (!located?.target) {
      showToast("Can't anchor there: the target isn't being tracked.");
      return;
    }
    const text = draftText.trim();
    if (tool === "text" && !text) {
      showToast("Type the instruction first, then tap where it goes.");
      return;
    }
    if (tool === "arrow" && !pendingArrowRef.current) {
      pendingArrowRef.current = located.target;
      setArrowPending(true);
      return;
    }
    const store = useRoomStore.getState();
    const now = store.serverNow();
    const start = tool === "arrow" ? pendingArrowRef.current! : located.target;
    store.addAnnotation({
      id: uuid(),
      type: tool === "laser" ? "pin" : tool,
      creatorId: selfId ?? "unknown",
      text: text || undefined,
      stepId: store.state?.currentStepId ?? undefined,
      createdAt: now,
      updatedAt: now,
      start,
      end: tool === "arrow" ? located.target : undefined,
    });
    pendingArrowRef.current = null;
    setArrowPending(false);
    setDraftText("");
  };

  const canAnnotate = role === "helper" && guided;

  const onPointerDown = (point: Vec2) => {
    logTap(`down ${point.x.toFixed(0)},${point.y.toFixed(0)} canAnnotate=${canAnnotate}`);
    if (!canAnnotate) return;
    pointerDownRef.current = point;
    if (tool === "laser") sendPointer(point, true);
  };
  const onPointerMove = (point: Vec2) => {
    if (canAnnotate && tool === "laser") sendPointer(point);
  };
  const onPointerUp = (point: Vec2) => {
    if (!canAnnotate) return;
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    logTap(`up ${point.x.toFixed(0)},${point.y.toFixed(0)} hadDown=${Boolean(down)}`);
    if (tool === "laser") {
      sendPointer(null, true);
      return;
    }
    if (down && Math.hypot(point.x - down.x, point.y - down.y) < TAP_SLOP_PX) placeAnnotation(point);
  };

  const changeTool = (next: Tool) => {
    setTool(next);
    pendingArrowRef.current = null;
    pendingWorldRef.current = null;
    setArrowPending(false);
  };

  const switchTracking = () => {
    useRoomStore.getState().setTracking(world ? "sheet" : "world");
    pendingArrowRef.current = null;
    pendingWorldRef.current = null;
    setArrowPending(false);
  };

  const resetTracking = () => {
    tracking.reset();
    pendingArrowRef.current = null;
    setArrowPending(false);
    showToast("Tracking reset - point the camera at the target.");
  };

  const reconnect = () => {
    if (role === "presenter") {
      if (helper) presenterLinkRef.current?.connectTo(helper.id).catch(console.warn);
      else showToast("No helper in the room yet.");
    } else if (presenter) {
      helperLinkRef.current?.requestOffer(presenter.id);
    } else {
      showToast("No presenter in the room yet.");
    }
  };

  const presenterLink = `${window.location.origin}/room/${roomCode}?role=presenter`;
  const helperLink = `${window.location.origin}/room/${roomCode}?role=helper`;
  const isLocalhost = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  const helperWorldStatus = worldStatus && Date.now() - worldStatus.ts < WORLD_STATUS_MAX_AGE_MS ? worldStatus.status : "off";
  const trackingChip = !world
    ? {
        ok: tracking.state === "ok" || tracking.state === "holding",
        label: `${TRACKING_LABEL[tracking.state]}${tracking.usingFallback ? " (presenter pose)" : ""}`,
      }
    : role === "presenter"
      ? { ok: worldPhase === "running", label: WORLD_PHASE_LABEL[worldPhase] }
      : {
          ok: helperWorldStatus === "normal",
          label: { normal: "World tracking", limited: "World tracking limited", starting: "World tracking starting", off: "World tracking off" }[
            helperWorldStatus
          ],
        };

  let stageMessage: ReactNode = null;
  if (role === "presenter") {
    if (presenterWorld || world === null) {
      stageMessage = null;
    } else if (camera.status === "error") {
      stageMessage = (
        <>
          <p>{camera.error}</p>
          <button type="button" className="big" onClick={() => camera.start()}>
            Start camera
          </button>
        </>
      );
    } else if (camera.status !== "ready") {
      stageMessage = <p>Starting camera…</p>;
    }
  } else if (!presenter) {
    stageMessage = (
      <>
        <p>
          Waiting for the presenter. Scan this on the phone that will film the object:
        </p>
        <QRCodeSVG value={presenterLink} size={168} includeMargin className="qr" />
        <code className="wrap">{presenterLink}</code>
        {isLocalhost && <p className="warn">This is a localhost link, so phones can't open it. Use the https ngrok URL instead.</p>}
      </>
    );
  } else if (!remoteStream) {
    stageMessage = <p>Presenter is here. Waiting for their camera…</p>;
  }

  return (
    <div className="room">
      <section className="stage">
        <video
          ref={videoRef}
          className={presenterWorld ? "video hidden" : mirrored ? "video mirrored" : "video"}
          autoPlay
          playsInline
          muted
        />
        {presenterWorld ? (
          <WorldStage
            annotationsRef={annotationsRef}
            onStream={setWorldStream}
            onPhase={setWorldPhase}
            onUseSheet={switchTracking}
            fake={fakeWorld}
            debug={debug}
          />
        ) : (
          <Overlay
            videoRef={videoRef}
            viewRef={tracking.viewRef}
            annotationsRef={annotationsRef}
            localPointerRef={localPointerRef}
            pendingArrowRef={pendingArrowRef}
            verifyStatusRef={verifyStatusRef}
            mirrored={mirrored}
            debug={debug && !world}
            showGuidance={guided}
            showVerifyZone={guided && showZone && !world}
            world={Boolean(world)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )}
        {stageMessage && <div className="stage-message">{stageMessage}</div>}
        <video ref={pipRef} className={showHelperPip ? "pip" : "pip hidden"} autoPlay playsInline muted />
        <video
          ref={selfViewRef}
          className={role === "helper" && helperCamStream ? "pip self" : "pip self hidden"}
          autoPlay
          playsInline
          muted
        />
        {needsSoundTap && (
          <button type="button" className="sound-tap" onClick={enableSound}>
            Tap to turn on sound
          </button>
        )}
        {toast && <div className="toast">{toast}</div>}
        {role === "presenter" && !presenterWorld && camera.status === "ready" && (
          <div className="stage-controls">
            <button type="button" onClick={() => camera.switchCamera()} aria-label="Switch camera">
              Flip
            </button>
            <button type="button" onClick={resetTracking}>
              Reset
            </button>
          </div>
        )}
      </section>
      <audio ref={audioRef} autoPlay />

      <aside className="sidebar">
        <header className="room-header">
          <div>
            <h1>Room {roomCode}</h1>
            <span className="muted">{role === "presenter" ? "Presenter (camera)" : "Helper (guide)"}</span>
          </div>
          <Link to="/" className="ghost-link">
            Leave
          </Link>
        </header>

        <div className="chips">
          <span className={connected ? "chip ok" : "chip bad"}>{connected ? "Server connected" : "Server offline"}</span>
          <span className={partnerPresent ? "chip ok" : "chip warn"}>
            {partnerPresent ? (role === "presenter" ? "Helper joined" : "Presenter joined") : `Waiting for ${role === "presenter" ? "helper" : "presenter"}`}
          </span>
          <span className={linkState === "connected" ? "chip ok" : linkState === "failed" ? "chip bad" : "chip warn"}>
            {linkLabel(linkState)}
          </span>
          <span className={trackingChip.ok ? "chip ok" : "chip bad"}>{trackingChip.label}</span>
          {role === "presenter" && !presenterWorld && camera.status === "error" && <span className="chip bad">Camera unavailable</span>}
        </div>

        <div className="controls">
          {role === "presenter" && !presenterWorld && (
            <>
              <button type="button" onClick={() => camera.start()}>
                {camera.status === "ready" ? "Restart camera" : "Start camera"}
              </button>
              <button type="button" onClick={() => camera.switchCamera()} disabled={camera.status === "starting"}>
                Use {camera.facingMode === "environment" ? "front" : "rear"} camera
              </button>
            </>
          )}
          {role === "helper" && (
            <>
              <button type="button" className={micStream ? "active" : undefined} onClick={toggleMic}>
                {micStream ? "Mute my mic" : "Turn on my mic"}
              </button>
              <button type="button" className={helperCamStream ? "active" : undefined} onClick={toggleHelperCamera}>
                {helperCamStream ? "Turn off my camera" : "Turn on my camera"}
              </button>
            </>
          )}
          {!world && (
            <button type="button" onClick={resetTracking}>
              Reset tracking
            </button>
          )}
          {role === "presenter" && world !== null && (
            <button type="button" onClick={switchTracking}>
              {world ? "Use printed sheet" : "Use world tracking"}
            </button>
          )}
          <button type="button" onClick={reconnect}>
            Reconnect video
          </button>
          <button type="button" className={debug ? "active" : "ghost"} onClick={() => setDebug((value) => !value)}>
            {debug ? "Hide debug" : "Show debug"}
          </button>
        </div>
        {micError && <p className="warn">{micError}</p>}
        {!guided && <p className="muted">Baseline condition: annotations and laser are hidden. Guide by voice only.</p>}

        {role === "helper" && guided && (
          <HelperTools
            tool={tool}
            onToolChange={changeTool}
            draftText={draftText}
            onDraftTextChange={setDraftText}
            arrowPending={arrowPending}
          />
        )}
        {role === "presenter" && (
          <details className="panel">
            <summary>Invite helper</summary>
            <QRCodeSVG value={helperLink} size={140} includeMargin className="qr" />
            <code className="wrap">{helperLink}</code>
          </details>
        )}
        <StepsPanel role={role} />
        {world ? (
          <p className="muted small-text">
            World tracking: no printed sheet needed. Verification and the benchmark use the printed sheet - switch with
            &ldquo;Use printed sheet&rdquo; on the presenter.
          </p>
        ) : (
          <>
            <VerifyPanel role={role} local={localVerify} showZone={showZone} onToggleZone={setShowZone} />
            <BenchPanel role={role} recorder={recorder} verificationRatio={localVerify?.ratio ?? null} />
            <p className="muted small-text">
              Print the <a href="/target.pdf" target="_blank" rel="noreferrer">tracking target</a> at 100% scale.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

/** JPEG of what a video element is showing, for remote debugging. */
function videoFrame(video: HTMLVideoElement | null) {
  if (!video?.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(720, video.videoWidth);
  canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
