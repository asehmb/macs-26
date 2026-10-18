import { buildPyramid, makeTemplate, matchAcrossScales, matchTemplate, type GrayImage } from "../client/src/world/patch.ts";

let failed = 0;
const W = 360;
const H = 620;

/** Smooth random texture, evaluated in "world" coordinates so it can be rendered under any similarity transform. */
const blobs = Array.from({ length: 1200 }, (_, i) => {
  const r = (n: number) => Math.abs(Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  // Mostly fine detail (1-3px at placement), which aliases if a zoomed-in view is sampled without a pyramid.
  return { x: r(1) * W, y: r(2) * H, s: i % 4 === 0 ? 4 + r(3) * 8 : 1 + r(3) * 2, v: r(4) * 200 - 100 };
});
function texture(x: number, y: number) {
  let value = 128;
  for (const b of blobs) {
    const d2 = (x - b.x) ** 2 + (y - b.y) ** 2;
    if (d2 < 9 * b.s * b.s) value += b.v * Math.exp(-d2 / (2 * b.s * b.s));
  }
  return value;
}

/** Render the texture as seen after moving by (tx, ty), rotating by `angle`, and scaling by `scale` about (cx, cy). */
function render(cx: number, cy: number, tx: number, ty: number, angle: number, scale: number): GrayImage {
  const data = new Float32Array(W * H);
  const cos = Math.cos(-angle) / scale;
  const sin = Math.sin(-angle) / scale;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - cx - tx;
      const dy = y - cy - ty;
      data[y * W + x] = texture(cx + cos * dx - sin * dy, cy + sin * dx + cos * dy);
    }
  }
  return { data, width: W, height: H };
}

const cx = 180;
const cy = 300;
const template = makeTemplate(render(cx, cy, 0, 0, 0, 1), cx, cy, 0);
if (!template) throw new Error("template rejected as flat");

// `estimate` is tracking's guess of the scale, which can be wrong; the true scale is `scale`.
const cases = [
  { name: "drift 25px", tx: 25, ty: -18, angle: 0, scale: 1, estimate: 1 },
  { name: "drift + 20deg roll", tx: -30, ty: 12, angle: 0.35, scale: 1, estimate: 1 },
  { name: "drift + 1.6x closer", tx: 20, ty: 20, angle: 0, scale: 1.6, estimate: 1.6 },
  { name: "drift + 2x closer", tx: 40, ty: -30, angle: 0.1, scale: 2, estimate: 2 },
  { name: "drift + 2x closer, estimate says 1.6x", tx: 40, ty: -30, angle: 0.1, scale: 2, estimate: 1.6 },
  { name: "drift + 0.7x further + roll", tx: -15, ty: -25, angle: -0.25, scale: 0.7, estimate: 0.7 },
];
for (const c of cases) {
  const pyramid = buildPyramid(render(cx, cy, c.tx, c.ty, c.angle, c.scale));
  // The SLAM prediction is the old spot; angle/scale come from the projected reference direction.
  const match = matchAcrossScales(pyramid, template, cx, cy, c.angle, c.estimate, 60);
  const error = match ? Math.hypot(match.x - (cx + c.tx), match.y - (cy + c.ty)) : Infinity;
  const ok = error <= 2.5 && (match?.score ?? 0) >= 0.8 && (match?.margin ?? 0) >= 0.1;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${c.name}: error ${error.toFixed(2)}px score ${match?.score.toFixed(3) ?? "-"} margin ${match?.margin.toFixed(3) ?? "-"} scale ${match?.scale.toFixed(2) ?? "-"}`,
  );
}

const zoomed = buildPyramid(render(cx, cy, 40, -30, 0.1, 2));
const started = performance.now();
for (let i = 0; i < 20; i += 1) matchAcrossScales(zoomed, template, cx + 7, cy - 5, 0.1, 1.2, 60);
console.log(`worst-case multi-scale search: ${((performance.now() - started) / 20).toFixed(1)} ms`);

const flat: GrayImage = { data: new Float32Array(W * H).fill(200), width: W, height: H };
const flatTemplate = makeTemplate(flat, cx, cy, 0);
console.log(flatTemplate === null ? "PASS flat patch is rejected" : (failed++, "FAIL flat patch accepted"));

const elsewhere = render(cx, cy, 0, 0, 0, 1);
const unrelated = matchTemplate(buildPyramid(elsewhere), template, 60, 520, 0, 1, 40);
console.log(`unrelated area: score ${unrelated?.score.toFixed(3) ?? "-"} margin ${unrelated?.margin.toFixed(3) ?? "-"}`);

if (failed) {
  console.error(`${failed} patch check(s) failed`);
  process.exit(1);
}
console.log("All patch checks passed");
