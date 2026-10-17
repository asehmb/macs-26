import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Annotation } from "../../../shared/src/types";
import { useCamera } from "../camera/useCamera";
import { Overlay } from "../overlay/Overlay";
import { RoomPeer } from "../rtc/peer";
import { addBenchRow } from "../state/bench";
import { useRoomStore } from "../state/room";
import { canvasToVideoPoint, computeVideoBox } from "../tracking/coords";
import { ArucoTracker } from "../tracking/detector";
import { projectPoint } from "../tracking/homography";
import { BOARD_SIZE_MM, clearTrackingFilters, computeTracking } from "../tracking/target";
import { verifyColorInZone } from "../tracking/verify";

const detector = new ArucoTracker();

export function Room() {
  const [searchParams] = useSearchParams();
  const role = (searchParams.get("role") as "presenter" | "helper") ?? "helper";
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const store = useRoomStore();
  const { state, peerCount } = store;
  const { state: cameraState, start, switchCamera } = useCamera();
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerState, setPeerState] = useState("new");
  const [peer, setPeer] = useState<RoomPeer | null>(null);
  const [homography, setHomography] = useState<number[] | null>(null);
  const [inverse, setInverse] = useState<number[] | null>(null);
  const [trackingLost, setTrackingLost] = useState(true);
  const [verifyStatus, setVerifyStatus] = useState("tracking_lost");
  const [verifyRatio, setVerifyRatio] = useState(0);
  const [draftType, setDraftType] = useState<"pin" | "arrow" | "text">("pin");
  const [draftText, setDraftText] = useState("Place this part here");
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  const activeAnnotations = useMemo(() => {
    if (!state) return [];
    return state.annotations.filter((annotation) =>
      state.currentStepId ? annotation.stepId === state.currentStepId : true,
    );
  }, [state]);

  useEffect(() => {
    store.connect(roomCode, role);
    return () => store.disconnect();
  }, [role, roomCode, store]);

  useEffect(() => {
    if (role === "presenter") {
      start().catch(() => undefined);
    }
  }, [role, start]);

  useEffect(() => {
    if (localVideoRef.current && cameraState.stream) {
      localVideoRef.current.srcObject = cameraState.stream;
      localVideoRef.current
        .play()
        .then(() => setLocalReady(true))
        .catch(() => setLocalReady(false));
    }
  }, [cameraState.stream]);

  useEffect(() => {
    if (role !== "presenter" || !peer || !cameraState.stream) return;
    const videoTrack = cameraState.stream.getVideoTracks()[0];
    if (videoTrack) {
      peer.replaceVideoTrack(videoTrack);
    }
  }, [cameraState.stream, peer, role]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => undefined);
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!store.socket || !store.roomCode) return;
    if (role === "presenter" && !cameraState.stream) return;
    const nextPeer = new RoomPeer(
      store.socket,
      store.roomCode,
      {
        onRemoteStream: setRemoteStream,
        onConnectionState: (status) => setPeerState(status),
      },
      cameraState.stream,
      role === "helper",
    );
    const signalHandler = async ({ from, data }: { from: string; data: any }) => {
      if (from === store.socket?.id) return;
      await nextPeer.handleSignal(data);
    };
    store.socket.on("signal", signalHandler);
    setPeer(nextPeer);
    return () => {
      store.socket?.off("signal", signalHandler);
      nextPeer.close();
    };
  }, [cameraState.stream, role, store.roomCode, store.socket]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const video = role === "presenter" ? localVideoRef.current : remoteVideoRef.current;
    if (!video) return;
    let raf = 0;
    const scratch = document.createElement("canvas");
    let lastRun = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!video.videoWidth || now - lastRun < 45) {
        return;
      }
      lastRun = now;
      const markers = detector.detect(video, scratch);
      const tracking = computeTracking(markers);
      setHomography(tracking.homography);
      setInverse(tracking.inverse);
      setTrackingLost(tracking.status !== "ok");
      if (role === "presenter") {
        store.sendPoseFallback({
          homography: tracking.homography,
          status: tracking.status,
          ts: Date.now(),
        });
      }

      if (tracking.referenceErrorPx !== null) {
        addBenchRow({ metric: "tracking_error_px", value: tracking.referenceErrorPx, note: `${role}` });
      }
      const verify = verifyColorInZone(video, tracking.homography, { x: 95, y: 130 }, { width: 32, height: 32 });
      setVerifyStatus(verify.status);
      setVerifyRatio(verify.ratio);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [now, role, store]);

  useEffect(() => {
    if (homography || !state?.poseFallback.homography) return;
    setHomography(state.poseFallback.homography);
  }, [homography, state?.poseFallback.homography]);

  const currentVideo = role === "presenter" ? localVideoRef.current : remoteVideoRef.current;
  const videoWidth = currentVideo?.videoWidth ?? 640;
  const videoHeight = currentVideo?.videoHeight ?? 480;

  const toTargetPoint = (canvasPoint: { x: number; y: number }) => {
    if (!currentVideo || !inverse) return null;
    const rect = currentVideo.getBoundingClientRect();
    const box = computeVideoBox(rect.width, rect.height, videoWidth, videoHeight);
    const videoPoint = canvasToVideoPoint(canvasPoint, box, role === "presenter" && cameraState.facingMode === "user", videoWidth);
    return projectPoint(inverse as any, videoPoint);
  };

  const addAnnotationAtPoint = (canvasPoint: { x: number; y: number }) => {
    if (role !== "helper") return;
    const target = toTargetPoint(canvasPoint);
    if (!target) return;
    if (draftType === "arrow" && !arrowStart) {
      setArrowStart(target);
      return;
    }
    const createdAt = Date.now();
    const annotation: Annotation = {
      id: uuid(),
      type: draftType,
      text: draftType === "text" ? draftText : undefined,
      creatorId: store.socket?.id ?? "unknown",
      createdAt,
      updatedAt: createdAt,
      start: arrowStart ?? target,
      end: draftType === "arrow" ? target : undefined,
      stepId: state?.currentStepId ?? undefined,
    };
    store.addAnnotation(annotation);
    addBenchRow({ metric: "annotation_emit", value: createdAt, note: annotation.type });
    setArrowStart(null);
  };

  const sendPointer = (canvasPoint: { x: number; y: number } | null) => {
    if (role !== "helper") return;
    if (!canvasPoint) {
      store.sendPointer({ position: null, ts: Date.now() });
      return;
    }
    const target = toTargetPoint(canvasPoint);
    if (!target) return;
    store.sendPointer({ position: target, ts: Date.now() });
  };

  const annotations = activeAnnotations;
  const videoElement = role === "presenter" ? localVideoRef : remoteVideoRef;
  const pointer = state?.pointer ?? { position: null, ts: 0 };

  return (
    <main className="room-page">
      <header className="top">
        <h1>Room {roomCode}</h1>
        <div className="chips">
          <span>{role}</span>
          <span>peers: {peerCount}</span>
          <span>peer: {peerState}</span>
          <span>{trackingLost ? "target lost" : "tracking ok"}</span>
          <span>{cameraState.error ? "camera denied" : "camera ready"}</span>
        </div>
      </header>
      <section className="video-shell">
        <video
          ref={videoElement}
          muted={role === "presenter"}
          autoPlay
          playsInline
          className="video"
        />
        <Overlay
          width={videoElement.current?.clientWidth ?? 640}
          height={videoElement.current?.clientHeight ?? 480}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          mirrored={role === "presenter" && cameraState.facingMode === "user"}
          homography={homography as any}
          annotations={annotations}
          pointer={pointer}
          trackingLost={trackingLost}
          onTap={addAnnotationAtPoint}
          onHoldPointer={sendPointer}
        />
      </section>
      <section className="controls">
        <button type="button" onClick={() => start().catch(() => undefined)}>
          Camera on
        </button>
        <button type="button" onClick={() => switchCamera().catch(() => undefined)}>
          Front/rear
        </button>
        <button
          type="button"
          onClick={() => {
            clearTrackingFilters();
            setTrackingLost(true);
          }}
        >
          Reset tracking
        </button>
        <button type="button" onClick={() => store.clearAnnotations()}>
          Clear annotations
        </button>
        <button type="button" onClick={() => peer?.reconnect()}>
          Reconnect peer
        </button>
      </section>
      {role === "helper" && (
        <section className="panel">
          <h2>Annotate</h2>
          <div className="row">
            <select value={draftType} onChange={(event) => setDraftType(event.target.value as any)}>
              <option value="pin">Pin</option>
              <option value="arrow">Arrow</option>
              <option value="text">Text</option>
            </select>
            <input
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder="Instruction text"
            />
          </div>
          <ul className="list">
            {state?.annotations.map((annotation) => (
              <li key={annotation.id}>
                <span>{annotation.type}</span>
                <button type="button" onClick={() => store.deleteAnnotation(annotation.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <h2>Steps</h2>
        <div className="row">
          <button type="button" onClick={() => store.advanceStep()}>
            Next step
          </button>
          <button
            type="button"
            onClick={() =>
              store.setSteps([
                { id: "step-1", title: "Align component", completed: false },
                { id: "step-2", title: "Fasten screw", completed: false },
                { id: "step-3", title: "Verify placement", completed: false },
              ])
            }
          >
            Load demo steps
          </button>
        </div>
        <ul className="list">
          {state?.steps.map((step) => (
            <li key={step.id}>
              <button type="button" onClick={() => store.toggleStep(step.id)}>
                {step.completed ? "Done" : "Todo"}
              </button>
              <span>{step.title}</span>
              {step.id === state.currentStepId ? <strong>current</strong> : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Verification</h2>
        <p>Status: {verifyStatus}</p>
        <p>Color ratio: {(verifyRatio * 100).toFixed(1)}%</p>
        <p>Target board mm: {BOARD_SIZE_MM.width}x{BOARD_SIZE_MM.height}</p>
        <p>
          <Link to="/bench">Open benchmark tools</Link>
        </p>
      </section>
      <footer className="footer">
        <p>Tip: print the target PDF from /public/target.pdf for stable tracking.</p>
        {!localReady && role === "presenter" ? <p>Tap camera on and allow permissions.</p> : null}
      </footer>
    </main>
  );
}
