import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OverlayView } from "../overlay/Overlay";
import { useRoomStore } from "../state/room";
import { FrameDetector, loadDetector, type DetectionResult } from "./detector";
import { scaleHomography } from "./homography";
import { TargetTracker, type TrackingFrame, type TrackingStatus } from "./tracker";

const FAST_INTERVAL_MS = 55;
const SLOW_INTERVAL_MS = 100;
const SLOW_DETECT_MS = 30;
const FALLBACK_MAX_AGE_MS = 600;

export type TrackerState = TrackingStatus | "loading" | "error";

type Options = {
  videoRef: RefObject<HTMLVideoElement | null>;
  useFallbackPose: boolean;
  onFrame?: (detection: DetectionResult, frame: TrackingFrame) => void;
};

export function useTracking({ videoRef, useFallbackPose, onFrame }: Options) {
  const viewRef = useRef<OverlayView>({ homography: null, status: "lost", usingFallback: false, markers: [] });
  const trackerRef = useRef(new TargetTracker());
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const fallbackRef = useRef(useFallbackPose);
  fallbackRef.current = useFallbackPose;
  const [state, setState] = useState<TrackerState>("loading");
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastRun = 0;
    let avgDetectMs = 0;
    let lastState: TrackerState = "loading";
    let lastFallback = false;

    const publish = (next: TrackerState, fallback: boolean) => {
      if (next !== lastState) {
        lastState = next;
        setState(next);
      }
      if (fallback !== lastFallback) {
        lastFallback = fallback;
        setUsingFallback(fallback);
      }
    };

    loadDetector()
      .then((detector) => {
        if (cancelled) return;
        const frameDetector = new FrameDetector(detector);
        publish("lost", false);

        const tick = (now: number) => {
          raf = requestAnimationFrame(tick);
          const video = videoRef.current;
          const interval = avgDetectMs > SLOW_DETECT_MS ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS;
          if (!video || video.readyState < 2 || now - lastRun < interval) return;
          lastRun = now;

          const detection = frameDetector.detect(video);
          if (!detection) return;
          avgDetectMs = avgDetectMs ? avgDetectMs * 0.9 + detection.elapsedMs * 0.1 : detection.elapsedMs;
          const frame = trackerRef.current.update(detection.markers, now);

          let homography = frame.homography;
          let status: TrackingStatus = frame.status;
          let fallback = false;
          if (!homography && fallbackRef.current) {
            const pose = useRoomStore.getState().poseFallback;
            if (pose?.homography && Date.now() - pose.ts < FALLBACK_MAX_AGE_MS) {
              homography = scaleHomography(pose.homography, video.videoWidth, video.videoHeight);
              status = "holding";
              fallback = true;
            }
          }

          viewRef.current = { homography, status, usingFallback: fallback, markers: detection.markers };
          publish(status, fallback);
          onFrameRef.current?.(detection, frame);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) publish("error", false);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [videoRef]);

  const reset = useCallback(() => {
    trackerRef.current.reset();
    viewRef.current = { homography: null, status: "lost", usingFallback: false, markers: [] };
  }, []);

  return { viewRef, state, usingFallback, reset };
}
