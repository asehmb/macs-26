import arucoUrl from "js-aruco2/src/aruco.js?url";
import cvUrl from "js-aruco2/src/cv.js?url";
import { ARUCO_DICTIONARY, MAX_HAMMING_DISTANCE } from "../../../shared/src/target-layout";
import type { MarkerDetection } from "./tracker";

type ArucoDetector = {
  detect(image: ImageData): Array<{ id: number; corners: Array<{ x: number; y: number }> }>;
};

type ArucoGlobal = {
  AR?: { Detector: new (config: { dictionaryName: string; maxHammingDistance: number }) => ArucoDetector };
};

export type DetectionResult = {
  markers: MarkerDetection[];
  /** Downscaled frame used for detection; reused by verification sampling. */
  image: ImageData;
  /** Multiply detection-frame pixels by these to get video pixels. */
  scaleX: number;
  scaleY: number;
  elapsedMs: number;
};

const DETECTION_WIDTH = 640;

let loading: Promise<ArucoDetector> | null = null;

function injectScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/** js-aruco2 is a browser-global script (it assigns window.CV / window.AR), so it is loaded as classic scripts. */
export function loadDetector(): Promise<ArucoDetector> {
  if (!loading) {
    loading = (async () => {
      const scope = globalThis as unknown as ArucoGlobal;
      if (!scope.AR) {
        await injectScript(cvUrl);
        await injectScript(arucoUrl);
      }
      if (!scope.AR) throw new Error("ArUco library did not initialise");
      return new scope.AR.Detector({
        dictionaryName: ARUCO_DICTIONARY,
        maxHammingDistance: MAX_HAMMING_DISTANCE,
      });
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export class FrameDetector {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { willReadFrequently: true });

  constructor(private detector: ArucoDetector) {}

  detect(video: HTMLVideoElement): DetectionResult | null {
    const { videoWidth, videoHeight } = video;
    if (!this.ctx || !videoWidth || !videoHeight) return null;
    const started = performance.now();
    const width = Math.min(DETECTION_WIDTH, videoWidth);
    const height = Math.round((width * videoHeight) / videoWidth);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.drawImage(video, 0, 0, width, height);
    const image = this.ctx.getImageData(0, 0, width, height);
    const scaleX = videoWidth / width;
    const scaleY = videoHeight / height;
    const markers = this.detector.detect(image).map((marker) => ({
      id: marker.id,
      corners: marker.corners.map((corner) => ({ x: corner.x * scaleX, y: corner.y * scaleY })),
    }));
    return { markers, image, scaleX, scaleY, elapsedMs: performance.now() - started };
  }
}
