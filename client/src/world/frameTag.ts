/**
 * Frame numbers burned into the presenter's outgoing video, so a helper tap can name the exact frame the helper was
 * looking at. Tracking moves on during the video delay, and resolving a tap against a later frame misplaces it.
 *
 * Layout: a strip of square cells along the bottom-left of the frame - white and black reference cells (to set the
 * threshold after compression), 12 frame-number bits (MSB first, white = 1), and an even-parity bit.
 */

export const TAG_BITS = 12;
export const TAG_MODULO = 1 << TAG_BITS;
const CELLS = 2 + TAG_BITS + 1;
/** Cell size as a fraction of the frame width (10 px in a 720 px wide frame). */
const CELL_FRACTION = 10 / 720;

export function tagCells(frame: number): boolean[] {
  const id = ((frame % TAG_MODULO) + TAG_MODULO) % TAG_MODULO;
  const bits = Array.from({ length: TAG_BITS }, (_, i) => Boolean((id >> (TAG_BITS - 1 - i)) & 1));
  const parity = bits.filter(Boolean).length % 2 === 1;
  return [true, false, ...bits, parity];
}

/** Inverse of tagCells from per-cell brightness samples; null if the strip is unreadable. */
export function decodeCells(luma: number[]): number | null {
  if (luma.length !== CELLS) return null;
  const [white, black] = luma;
  if (white - black < 60) return null;
  const threshold = (white + black) / 2;
  const bits = luma.slice(2).map((value) => value > threshold);
  const data = bits.slice(0, TAG_BITS);
  if (data.filter(Boolean).length % 2 !== (bits[TAG_BITS] ? 1 : 0)) return null;
  return data.reduce((id, bit) => (id << 1) | (bit ? 1 : 0), 0);
}

export function drawTag(ctx: CanvasRenderingContext2D, frame: number, width: number, height: number) {
  const cell = Math.max(4, Math.round(width * CELL_FRACTION));
  const y = height - cell;
  tagCells(frame).forEach((on, i) => {
    ctx.fillStyle = on ? "#ffffff" : "#000000";
    ctx.fillRect(i * cell, y, cell, cell);
  });
}

let reader: CanvasRenderingContext2D | null = null;

/** Read the tag from the frame a video element is currently showing. */
export function readTag(video: HTMLVideoElement): number | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const cell = width * CELL_FRACTION;
  if (!reader) reader = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!reader) return null;
  const canvas = reader.canvas;
  canvas.width = Math.ceil(cell * CELLS);
  canvas.height = Math.ceil(cell);
  reader.drawImage(video, 0, height - cell, cell * CELLS, cell, 0, 0, cell * CELLS, cell);
  const pixels = reader.getImageData(0, 0, canvas.width, canvas.height).data;
  const luma = Array.from({ length: CELLS }, (_, i) => {
    // Average the middle of each cell, away from compression ringing at the edges.
    let sum = 0;
    let count = 0;
    for (let y = Math.floor(cell * 0.3); y < Math.ceil(cell * 0.7); y += 1) {
      for (let x = Math.floor(cell * (i + 0.3)); x < Math.ceil(cell * (i + 0.7)); x += 1) {
        const j = (y * canvas.width + x) * 4;
        sum += 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2];
        count += 1;
      }
    }
    return count ? sum / count : 0;
  });
  return decodeCells(luma);
}
