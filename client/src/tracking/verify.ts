import { projectPoint, type Homography } from "./homography";

function rgbToHsv(r: number, g: number, b: number) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const diff = max - min;
  let h = 0;
  if (diff !== 0) {
    if (max === rr) h = ((gg - bb) / diff) % 6;
    else if (max === gg) h = (bb - rr) / diff + 2;
    else h = (rr - gg) / diff + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : diff / max;
  const v = max;
  return { h, s, v };
}

export function verifyColorInZone(
  video: HTMLVideoElement,
  homography: Homography | null,
  zoneTopLeft: { x: number; y: number },
  zoneSize: { width: number; height: number },
): { ratio: number; status: "aligned" | "not_yet" | "tracking_lost" } {
  if (!homography) {
    return { ratio: 0, status: "tracking_lost" };
  }

  const p = projectPoint(homography, zoneTopLeft);
  const p2 = projectPoint(homography, {
    x: zoneTopLeft.x + zoneSize.width,
    y: zoneTopLeft.y + zoneSize.height,
  });
  const x = Math.max(0, Math.min(p.x, p2.x));
  const y = Math.max(0, Math.min(p.y, p2.y));
  const width = Math.max(1, Math.abs(p2.x - p.x));
  const height = Math.max(1, Math.abs(p2.y - p.y));

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ratio: 0, status: "not_yet" };

  ctx.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let hits = 0;
  let total = 0;
  for (let i = 0; i < imageData.data.length; i += 4) {
    const { h, s, v } = rgbToHsv(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
    if (h >= 25 && h <= 90 && s > 0.35 && v > 0.2) hits += 1;
    total += 1;
  }
  const ratio = total ? hits / total : 0;
  return { ratio, status: ratio > 0.25 ? "aligned" : "not_yet" };
}
