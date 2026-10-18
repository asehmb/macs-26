import { useCallback, useEffect, useRef, useState } from "react";
import { openSyntheticCamera } from "./syntheticCamera";

export type FacingMode = "environment" | "user";

export type CameraStatus = "idle" | "starting" | "ready" | "error";

function describeError(error: unknown): string {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "Camera needs HTTPS. Open the https:// link (for example the ngrok URL), not an http:// address.";
  }
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access for this site in your browser settings, then tap Start camera.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No matching camera was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy. Close other apps or tabs using it, then tap Start camera.";
    default:
      return error instanceof Error ? error.message : "Could not start the camera.";
  }
}

async function openCamera(facingMode: FacingMode): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video,
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    // A denied or missing microphone should not block the camera.
    if (error instanceof DOMException && error.name === "NotReadableError") throw error;
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

export function useCamera({ synthetic = false }: { synthetic?: boolean } = {}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<FacingMode>("environment");
  const requestRef = useRef(0);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const start = useCallback(async (nextFacing: FacingMode = facingRef.current) => {
    const request = ++requestRef.current;
    setStatus("starting");
    setError(null);
    stopTracks();
    setStream(null);
    try {
      const next = synthetic ? await openSyntheticCamera() : await openCamera(nextFacing);
      if (request !== requestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      next.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (streamRef.current !== next) return;
        setStatus("error");
        setError("The camera stopped (another app may have taken it). Tap Start camera.");
      });
      streamRef.current = next;
      facingRef.current = nextFacing;
      setFacingMode(nextFacing);
      setStream(next);
      setStatus("ready");
    } catch (cameraError) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setError(describeError(cameraError));
    }
  }, [synthetic]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    stopTracks();
    setStream(null);
    setStatus("idle");
    setError(null);
  }, []);

  const switchCamera = useCallback(
    () => start(facingRef.current === "environment" ? "user" : "environment"),
    [start],
  );

  useEffect(
    () => () => {
      requestRef.current += 1;
      stopTracks();
    },
    [],
  );

  return { stream, status, error, facingMode, start, stop, switchCamera };
}
