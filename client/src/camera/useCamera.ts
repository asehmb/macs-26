import { useCallback, useEffect, useMemo, useState } from "react";

export type CameraState = {
  stream: MediaStream | null;
  error: string | null;
  facingMode: "environment" | "user";
  requesting: boolean;
};

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [requesting, setRequesting] = useState(false);

  const stop = useCallback(() => {
    setStream((prev) => {
      prev?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const start = useCallback(async (nextFacingMode = facingMode) => {
    setRequesting(true);
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode } },
        audio: true,
      });
      stop();
      setStream(next);
      setFacingMode(nextFacingMode);
    } catch (cameraError) {
      setError(
        cameraError instanceof Error
          ? cameraError.message
          : "Unable to access camera. Check permissions and HTTPS.",
      );
    } finally {
      setRequesting(false);
    }
  }, [facingMode, stop]);

  const switchCamera = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    await start(next);
  }, [facingMode, start]);

  useEffect(() => stop, [stop]);

  return useMemo(
    () => ({
      state: { stream, error, facingMode, requesting } satisfies CameraState,
      start,
      stop,
      switchCamera,
    }),
    [error, facingMode, requesting, start, stop, stream, switchCamera],
  );
}
