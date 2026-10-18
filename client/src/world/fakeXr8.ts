import type { HitResult, PipelineModule, Reality, Vec3, WorldPoint, XR8Api } from "./xr8";

/**
 * Development stand-in for the 8th Wall engine (`?fakeworld=1`): a camera swaying in front of a textured wall at
 * z = -1, with world points on the wall and a slowly drifting reported pose so re-anchoring has something to fix.
 */
export async function loadFakeXR8(): Promise<XR8Api> {
  let modules: PipelineModule[] = [];
  let raf = 0;
  let pose = { x: 0, y: 1.5, z: 0 };
  let focal = 1;
  let size = { width: 1, height: 1 };

  const pattern = makePattern();
  const PX_PER_UNIT = 400;
  const WALL = { left: -1.5, top: 3 };

  const depthOf = (camera: Vec3) => camera.z + 1;
  const hitTest = (x: number, y: number): HitResult[] => {
    const d = depthOf(pose);
    const position = {
      x: pose.x + ((x - 0.5) * size.width * d) / focal,
      y: pose.y - ((y - 0.5) * size.height * d) / focal,
      z: -1,
    };
    return [{ type: "FEATURE_POINT", position, distance: d }];
  };

  const api: XR8Api = {
    addCameraPipelineModules: (next) => {
      modules = [...modules, ...next];
    },
    clearCameraPipelineModules: () => {
      modules = [];
    },
    loadChunk: async () => undefined,
    stop: () => cancelAnimationFrame(raf),
    run: ({ canvas }) => {
      const ctx = canvas.getContext("2d")!;
      size = { width: canvas.clientWidth, height: canvas.clientHeight };
      focal = 0.9 * size.width;
      const args = { canvas, canvasWidth: canvas.width, canvasHeight: canvas.height, processCpuResult: {} };
      modules.forEach((m) => m.onStart?.(args));
      const started = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const t = (now - started) / 1000;
        const actual = { x: 0.12 * Math.sin(t / 3), y: 1.5 + 0.05 * Math.sin(t / 4), z: 0.2 + 0.15 * Math.sin(t / 5) };
        // What tracking reports drifts a few centimetres from the truth, like SLAM after the view moves.
        const drift = 0.02 * Math.sin(t / 7);
        pose = { x: actual.x + drift, y: actual.y, z: actual.z };

        const d = depthOf(actual);
        const scale = (focal / d / PX_PER_UNIT) * (canvas.width / size.width);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(
          scale,
          0,
          0,
          scale,
          cx + (focal / d) * (WALL.left - actual.x) * (canvas.width / size.width),
          cy - (focal / d) * (WALL.top - actual.y) * (canvas.width / size.width),
        );
        ctx.drawImage(pattern, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const reality: Reality = {
          position: pose,
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          intrinsics: [(2 * focal) / size.width, 0, 0, 0, 0, (2 * focal) / size.height, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0],
          trackingStatus: "NORMAL",
          trackingReason: "UNSPECIFIED",
          worldPoints: wallPoints(pose, focal, size),
        };
        const update = { ...args, processCpuResult: { reality } };
        modules.forEach((m) => m.onUpdate?.(update));
        modules.forEach((m) => m.onRender?.());
      };
      raf = requestAnimationFrame(frame);
    },
    GlTextureRenderer: { pipelineModule: () => ({ name: "fake-renderer" }) },
    XrController: {
      pipelineModule: () => ({ name: "fake-controller" }),
      configure: () => undefined,
      hitTest: (x, y) => hitTest(x, y),
      recenter: () => undefined,
      updateCameraProjectionMatrix: () => undefined,
    },
    XrConfig: { device: () => ({ MOBILE: "mobile", ANY: "any" }), camera: () => ({ BACK: "back" }) },
  };
  return api;
}

/** A grid of map points on the wall, limited to what is roughly in view. */
function wallPoints(pose: Vec3, focal: number, size: { width: number; height: number }): WorldPoint[] {
  const d = pose.z + 1;
  const halfW = (size.width / 2 / focal) * d;
  const halfH = (size.height / 2 / focal) * d;
  const points: WorldPoint[] = [];
  const step = 0.04;
  for (let i = Math.floor((pose.x - halfW) / step); i <= Math.ceil((pose.x + halfW) / step); i += 1) {
    for (let j = Math.floor((pose.y - halfH) / step); j <= Math.ceil((pose.y + halfH) / step); j += 1) {
      points.push({ id: (i + 1000) * 10000 + (j + 1000), confidence: 1, position: { x: i * step, y: j * step, z: -1 } });
    }
  }
  return points;
}

function makePattern() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d")!;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  ctx.fillStyle = "#d6d3d1";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `hsl(${Math.floor(random() * 360)}, ${30 + random() * 50}%, ${20 + random() * 60}%)`;
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const s = 4 + random() * 30;
    if (random() < 0.5) ctx.fillRect(x, y, s, s * (0.3 + random()));
    else {
      ctx.beginPath();
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#111";
  ctx.font = "700 28px system-ui, sans-serif";
  for (let i = 0; i < 40; i += 1) ctx.fillText(`PART ${Math.floor(random() * 900 + 100)}`, random() * 1100, random() * 1200);
  return canvas;
}
