export type MarkerDetection = {
  id: number;
  corners: Array<{ x: number; y: number }>;
};

export class ArucoTracker {
  private detector: any = null;

  private loading: Promise<void> | null = null;

  private async ensureLoaded() {
    if (this.detector) return;
    if (!this.loading) {
      this.loading = (async () => {
        const globalAny = globalThis as unknown as {
          AR?: { Detector: new (config?: { dictionaryName?: string }) => any };
        };
        if (!globalAny.AR) {
          await this.inject("https://unpkg.com/js-aruco2@2.0.0/src/cv.js");
          await this.inject("https://unpkg.com/js-aruco2@2.0.0/src/aruco.js");
        }
        if (globalAny.AR) {
          this.detector = new globalAny.AR.Detector({ dictionaryName: "ARUCO_MIP_36h12" });
        }
      })();
    }
    await this.loading;
  }

  private inject(src: string) {
    return new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[data-aruco-src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.arucoSrc = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  detect(video: HTMLVideoElement, canvas: HTMLCanvasElement): MarkerDetection[] {
    void this.ensureLoaded();
    if (!this.detector) {
      return [];
    }
    const width = Math.min(640, video.videoWidth || 640);
    const height = Math.max(1, Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640))));

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return [];
    }

    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const markers: Array<{ id: number; corners: Array<{ x: number; y: number }> }> =
      this.detector.detect(imageData);
    const sx = (video.videoWidth || width) / width;
    const sy = (video.videoHeight || height) / height;

    return markers.map((marker: { id: number; corners: Array<{ x: number; y: number }> }) => ({
      id: marker.id,
      corners: marker.corners.map((corner: { x: number; y: number }) => ({ x: corner.x * sx, y: corner.y * sy })),
    }));
  }
}
