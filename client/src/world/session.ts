import { PointTracker, type PlaceResult } from "./anchoring";
import { drawTag, TAG_MODULO } from "./frameTag";
import { toGray, type GrayImage } from "./patch";
import { loadXR8, projectWorldPoint, requestMotionPermission, type Reality, type Vec3, type XR8Api } from "./xr8";

export type WorldPhase = "idle" | "starting" | "running" | "error";

/** Draws annotations in CSS pixels of the view; `project` maps a world point to those pixels (null if behind the camera). */
export type WorldDraw = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: (point: Vec3) => { x: number; y: number } | null,
) => void;

type Options = {
  onPhase: (phase: WorldPhase, message?: string) => void;
  /** Annotations to burn into the outgoing video, drawn after the camera image. */
  drawComposite?: WorldDraw;
  /** Called every engine frame, after points have followed the map. */
  onReality?: (reality: Reality) => void;
  /** Development harness that renders a synthetic scene instead of running the engine. */
  loadEngine?: () => Promise<XR8Api>;
  /**
   * Runs after motion permission and before the camera starts - e.g. to ask for the microphone, whose permission
   * prompt would otherwise interrupt tracking while it builds its first map.
   */
  beforeEngine?: () => Promise<void>;
  /** Stamp outgoing frames with a frame number so remote taps can be resolved against the frame the helper saw. */
  tagFrames?: boolean;
};

const COMPOSITE_WIDTH = 720;
const CAPTURE_FPS = 30;
const VISION_WIDTH = 360;
const VISION_INTERVAL_MS = 66;
/** Tracking state of recent outgoing frames, covering the video delay to the helper. */
const HISTORY_FRAMES = 120;

type FrameState = Pick<Reality, "position" | "rotation" | "intrinsics" | "trackingStatus" | "trackingReason" | "worldPoints">;

/**
 * Markerless tracking on the presenter's phone: 8th Wall SLAM renders the camera into `canvas`, taps become
 * tracked world points, and the camera image plus annotations is composited into a stream for the helper.
 */
export class WorldSession {
  readonly tracker: PointTracker;
  reality: Reality | null = null;
  stream: MediaStream | null = null;
  composite: HTMLCanvasElement | null = null;
  stats = { engineFps: 0, visionMs: 0 };
  /** Limits snapping to points that are currently shown. */
  isActive: (id: string) => boolean = () => true;

  private xr: XR8Api | null = null;
  private vision: HTMLCanvasElement | null = null;
  /** Shared with the tracker; sized once the view's aspect is known. */
  private visionInfo = { width: VISION_WIDTH, height: VISION_WIDTH, grab: () => this.grabVision() };
  private stopped = false;
  private frame = 0;
  private history = new Map<number, FrameState>();

  constructor(
    private canvas: HTMLCanvasElement,
    private options: Options,
  ) {
    this.tracker = new PointTracker(this.visionInfo);
  }

  /** Must be called from a user gesture: iOS only grants motion sensors (which SLAM needs) from one. */
  async start() {
    const { onPhase } = this.options;
    onPhase("starting");
    try {
      if (!this.options.loadEngine) {
        if (!/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) && navigator.maxTouchPoints < 2) {
          throw new Error("World tracking runs on phones. On a laptop or desktop, use the printed sheet instead.");
        }
        const motion = await requestMotionPermission();
        if (motion !== "granted") throw new Error("Motion & orientation access was denied. World tracking needs it.");
      }
      await this.options.beforeEngine?.();
      const XR8 = await (this.options.loadEngine ?? loadXR8)();
      await XR8.loadChunk("slam");
      if (this.stopped) return;
      this.xr = XR8;
      this.run(XR8);
    } catch (error) {
      onPhase("error", error instanceof Error ? error.message : String(error));
    }
  }

  stop() {
    this.stopped = true;
    try {
      this.xr?.stop();
      this.xr?.clearCameraPipelineModules();
    } catch {
      // The engine may not have started.
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.xr = null;
  }

  recenter() {
    this.xr?.XrController.recenter();
    this.tracker.clear();
  }

  /**
   * Place a point at normalised 0..1 coordinates of the view (the same frame as the outgoing video). With `frame`
   * (read from the video the helper tapped), depth comes from the tracking state of that frame.
   */
  placeNormalized(id: string, point: { x: number; y: number }, frame?: number | null): PlaceResult {
    const reality = this.reality;
    const XR8 = this.xr;
    if (!reality || !XR8) return { ok: false, reason: "World tracking is still starting on the presenter's phone." };
    if (reality.trackingStatus === "LIMITED" && !(reality.worldPoints?.length ?? 0)) {
      return { ok: false, reason: "The presenter's phone hasn't mapped the scene yet - ask them to move it slowly." };
    }
    const seen = frame == null ? undefined : this.history.get(frame);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    return this.tracker.place(id, reality, { x: point.x * width, y: point.y * height }, width, height, {
      seen,
      hitTest: (x, y) => XR8.XrController.hitTest(x, y, ["FEATURE_POINT"])[0],
    });
  }

  project(point: Vec3, width: number, height: number) {
    const reality = this.reality;
    if (!reality) return null;
    const at = projectWorldPoint(reality, point, width, height);
    return at && at.depth > 0 ? { x: at.x, y: at.y } : null;
  }

  private run(XR8: XR8Api) {
    const { onPhase } = this.options;
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);

    const composite = document.createElement("canvas");
    composite.width = COMPOSITE_WIDTH;
    composite.height = Math.round((COMPOSITE_WIDTH * canvas.height) / canvas.width / 2) * 2;
    this.composite = composite;
    const compositeCtx = composite.getContext("2d")!;

    const vision = document.createElement("canvas");
    vision.width = VISION_WIDTH;
    vision.height = Math.round((VISION_WIDTH * canvas.height) / canvas.width);
    this.vision = vision;
    this.visionInfo.width = vision.width;
    this.visionInfo.height = vision.height;

    const updateProjection = (width: number, height: number) =>
      XR8.XrController.updateCameraProjectionMatrix({
        cam: { pixelRectWidth: width, pixelRectHeight: height, nearClipPlane: 0.01, farClipPlane: 1000 },
        origin: { x: 0, y: 1.5, z: 0 },
        facing: { w: 1, x: 0, y: 0, z: 0 },
      });

    let frames = 0;
    let windowStart = performance.now();
    let lastVision = 0;
    let lastComposite = 0;

    XR8.XrController.configure({ scale: "responsive", enableWorldPoints: true });
    XR8.clearCameraPipelineModules();
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.XrController.pipelineModule(),
      {
        name: "realitycheck-world",
        onStart: ({ canvasWidth, canvasHeight }) => {
          updateProjection(canvasWidth, canvasHeight);
          onPhase("running");
        },
        onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => updateProjection(canvasWidth, canvasHeight),
        onUpdate: ({ processCpuResult }) => {
          const reality = processCpuResult.reality;
          if (reality) {
            this.reality = reality;
            this.tracker.follow(reality);
            this.options.onReality?.(reality);
          }
          frames += 1;
          const now = performance.now();
          if (now - windowStart >= 1000) {
            this.stats.engineFps = (frames * 1000) / (now - windowStart);
            frames = 0;
            windowStart = now;
          }
        },
        onRender: () => {
          const now = performance.now();
          const reality = this.reality;
          if (reality && now - lastVision >= VISION_INTERVAL_MS && this.tracker.points.size) {
            lastVision = now;
            this.tracker.snapNext(reality, now, (point) => this.isActive(point.id));
            this.stats.visionMs = performance.now() - now;
          }
          // The stream only carries CAPTURE_FPS; compositing every engine frame just takes time from tracking.
          if (now - lastComposite < 1000 / CAPTURE_FPS - 4) return;
          lastComposite = now;
          compositeCtx.setTransform(1, 0, 0, 1, 0, 0);
          compositeCtx.drawImage(canvas, 0, 0, composite.width, composite.height);
          const draw = this.options.drawComposite;
          if (draw) {
            // Draw in the view's CSS pixels so sizes match what the presenter sees on screen.
            const cssWidth = canvas.clientWidth || composite.width;
            const scale = composite.width / cssWidth;
            const cssHeight = composite.height / scale;
            compositeCtx.setTransform(scale, 0, 0, scale, 0, 0);
            draw(compositeCtx, cssWidth, cssHeight, (point) => this.project(point, cssWidth, cssHeight));
            compositeCtx.setTransform(1, 0, 0, 1, 0, 0);
          }
          if (this.options.tagFrames && reality) {
            this.frame = (this.frame + 1) % TAG_MODULO;
            this.remember(this.frame, reality);
            drawTag(compositeCtx, this.frame, composite.width, composite.height);
          }
        },
        onException: (error) => {
          if (!this.reality) onPhase("error", `Tracking engine error: ${error instanceof Error ? error.message : String(error)}`);
        },
        onCameraStatusChange: ({ status }) => {
          if (status === "failed") onPhase("error", "The camera failed to start. Check camera permission for this site.");
        },
      },
    ]);

    this.stream = composite.captureStream(CAPTURE_FPS);
    const track = this.stream.getVideoTracks()[0];
    if (track) track.contentHint = "motion";

    XR8.run({
      canvas,
      allowedDevices: this.options.loadEngine ? XR8.XrConfig.device().ANY : XR8.XrConfig.device().MOBILE,
      glContextConfig: { preserveDrawingBuffer: true },
    });
  }

  /** Copy, since the engine may reuse its result objects between frames. */
  private remember(frame: number, reality: Reality) {
    this.history.set(frame, {
      position: { ...reality.position },
      rotation: { ...reality.rotation },
      intrinsics: [...reality.intrinsics],
      trackingStatus: reality.trackingStatus,
      trackingReason: reality.trackingReason,
      worldPoints: reality.worldPoints?.map((point) => ({ ...point, position: { ...point.position } })),
    });
    this.history.delete((frame - HISTORY_FRAMES + TAG_MODULO) % TAG_MODULO);
  }

  /** Camera frame (without annotations) at vision resolution, grayscale. */
  private grabVision(): GrayImage | null {
    const vision = this.vision;
    if (!vision) return null;
    const ctx = vision.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(this.canvas, 0, 0, vision.width, vision.height);
    return toGray(ctx.getImageData(0, 0, vision.width, vision.height));
  }
}
