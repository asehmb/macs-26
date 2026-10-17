import { ARUCO_DICTIONARY, BOARD, MARKERS, TEST_DOT, VERIFY_ZONE } from "../../../shared/src/target-layout";
import { loadDetector } from "../tracking/detector";

const PX_PER_MM = 4;
const WIDTH = 1280;
const HEIGHT = 720;

type ArucoGlobal = { AR?: { Dictionary: new (name: string) => { codeList: string[] } } };

async function renderBoard() {
  await loadDetector();
  const AR = (globalThis as unknown as ArucoGlobal).AR!;
  const dictionary = new AR.Dictionary(ARUCO_DICTIONARY);
  const canvas = document.createElement("canvas");
  canvas.width = BOARD.width * PX_PER_MM;
  canvas.height = BOARD.height * PX_PER_MM;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PX_PER_MM, PX_PER_MM);
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, BOARD.width, BOARD.height);
  for (const marker of MARKERS) {
    const bits = dictionary.codeList[marker.id];
    const n = Math.sqrt(bits.length);
    const cell = marker.size / (n + 2);
    ctx.fillStyle = "#000";
    ctx.fillRect(marker.x, marker.y, marker.size, marker.size);
    ctx.fillStyle = "#fff";
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        if (bits[row * n + col] === "1") {
          ctx.fillRect(marker.x + (col + 1) * cell, marker.y + (row + 1) * cell, cell, cell);
        }
      }
    }
  }
  ctx.fillStyle = "#e11d48";
  ctx.beginPath();
  ctx.arc(TEST_DOT.x, TEST_DOT.y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 0.6;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(VERIFY_ZONE.x, VERIFY_ZONE.y, VERIFY_ZONE.width, VERIFY_ZONE.height);
  return canvas;
}

/**
 * A fake camera that films the target board drifting and rotating, for testing the
 * full pipeline (and demoing) on devices without a usable camera. Enable with ?synthetic=1.
 */
export async function openSyntheticCamera(): Promise<MediaStream> {
  const board = await renderBoard();
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const started = performance.now();
  let placed = false;
  let raf = 0;

  const draw = () => {
    raf = requestAnimationFrame(draw);
    const t = (performance.now() - started) / 1000;
    ctx.fillStyle = "#3f3f46";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.translate(WIDTH / 2 + Math.sin(t * 0.5) * 220, HEIGHT / 2 + Math.sin(t * 0.37) * 60);
    ctx.rotate(Math.sin(t * 0.3) * 0.6);
    const scale = (0.6 + 0.08 * Math.sin(t * 0.23)) * (HEIGHT / board.height);
    ctx.scale(scale, scale);
    ctx.drawImage(board, -board.width / 2, -board.height / 2);
    // Every 10 s a blue "part" is placed in the verification zone for 5 s.
    placed = Math.floor(t / 5) % 2 === 1;
    if (placed) {
      ctx.fillStyle = "#2563eb";
      const zx = VERIFY_ZONE.x * PX_PER_MM - board.width / 2;
      const zy = VERIFY_ZONE.y * PX_PER_MM - board.height / 2;
      ctx.fillRect(zx + 40, zy + 30, VERIFY_ZONE.width * PX_PER_MM - 80, VERIFY_ZONE.height * PX_PER_MM - 60);
    }
    ctx.restore();
  };
  draw();

  const stream = canvas.captureStream(30);
  stream.getVideoTracks()[0].addEventListener("ended", () => cancelAnimationFrame(raf));
  const originalStop = MediaStreamTrack.prototype.stop;
  for (const track of stream.getTracks()) {
    track.stop = function stop() {
      cancelAnimationFrame(raf);
      originalStop.call(this);
    };
  }
  return stream;
}
