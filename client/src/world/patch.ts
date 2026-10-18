/**
 * Visual re-anchoring: a pin remembers a small grayscale patch of its surroundings and, when SLAM's prediction
 * drifts (typically after the area leaves the frame and returns), the patch is searched for near the prediction.
 */

export type GrayImage = { data: Float32Array; width: number; height: number };

export type Template = { data: Float32Array; size: number; mean: number; norm: number };

/** `margin` is how much the best score beats the best alternative elsewhere in the window. */
export type MatchResult = { x: number; y: number; score: number; shift: number; margin: number };

export type ScaledMatch = MatchResult & { scale: number };

export const TEMPLATE_SIZE = 31;

/** Half-resolution 2x2 box filter; level k pixel (i, j) covers level 0 pixels centred at 2^k * (i, j) + (2^k - 1) / 2. */
function halve(image: GrayImage): GrayImage {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Float32Array(width * height);
  const src = image.data;
  const w = image.width;
  for (let y = 0; y < height; y += 1) {
    const row = 2 * y * w;
    for (let x = 0; x < width; x += 1) {
      const i = row + 2 * x;
      data[y * width + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4;
    }
  }
  return { data, width, height };
}

/** Zoomed-in views must be matched on a downsampled image, or sampling every 2nd+ pixel aliases fine detail. */
export function buildPyramid(image: GrayImage, levels = 3): GrayImage[] {
  const pyramid = [image];
  while (pyramid.length < levels && pyramid[pyramid.length - 1].width >= 64) pyramid.push(halve(pyramid[pyramid.length - 1]));
  return pyramid;
}

export function toGray(image: ImageData): GrayImage {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return { data: gray, width, height };
}

function sample(image: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return Number.NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * image.width;
  const row1 = y1 * image.width;
  const top = image.data[row0 + x0] * (1 - fx) + image.data[row0 + x1] * fx;
  const bottom = image.data[row1 + x0] * (1 - fx) + image.data[row1 + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Resample a square region centred on (cx, cy) into the template's frame: one output pixel = `scale` image
 * pixels, rotated by `angle`. Returns null if any sample falls outside the image.
 */
function rectify(image: GrayImage, cx: number, cy: number, size: number, angle: number, scale: number): Float32Array | null {
  const out = new Float32Array(size * size);
  const half = (size - 1) / 2;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  for (let v = 0; v < size; v += 1) {
    for (let u = 0; u < size; u += 1) {
      const du = u - half;
      const dv = v - half;
      const value = sample(image, cx + cos * du - sin * dv, cy + sin * du + cos * dv);
      if (Number.isNaN(value)) return null;
      out[v * size + u] = value;
    }
  }
  return out;
}

export function makeTemplate(image: GrayImage, cx: number, cy: number, angle: number): Template | null {
  const data = rectify(image, cx, cy, TEMPLATE_SIZE, angle, 1);
  if (!data) return null;
  let mean = 0;
  for (const value of data) mean += value;
  mean /= data.length;
  let norm = 0;
  for (let i = 0; i < data.length; i += 1) {
    data[i] -= mean;
    norm += data[i] * data[i];
  }
  norm = Math.sqrt(norm);
  // A flat patch (blank wall, white desk) can't be matched reliably.
  if (norm / TEMPLATE_SIZE < 6) return null;
  return { data, size: TEMPLATE_SIZE, mean, norm };
}

/**
 * Search for the template around (cx, cy) in the current image, within `radius` image pixels.
 * `angle`/`scale` map template pixels to the current view (from the pin's projected reference direction).
 */
export function matchTemplate(
  pyramid: GrayImage[],
  template: Template,
  cx: number,
  cy: number,
  angle: number,
  scale: number,
  radius: number,
): MatchResult | null {
  let level = 0;
  while (level + 1 < pyramid.length && scale / 2 ** level >= 1.5) level += 1;
  const factor = 2 ** level;
  const offset = (factor - 1) / 2;
  const match = matchAtLevel(pyramid[level], template, (cx - offset) / factor, (cy - offset) / factor, angle, scale / factor, radius / factor);
  if (!match) return null;
  return { ...match, x: match.x * factor + offset, y: match.y * factor + offset, shift: match.shift * factor };
}

/**
 * Tracking's distance estimate (hence the expected patch size) can be off by tens of percent: climb towards the
 * better-scoring scale in ~19% steps, then refine by ~9% either side of the best.
 */
export function matchAcrossScales(
  pyramid: GrayImage[],
  template: Template,
  cx: number,
  cy: number,
  angle: number,
  scale: number,
  radius: number,
): ScaledMatch | null {
  const first = matchTemplate(pyramid, template, cx, cy, angle, scale, radius);
  if (!first) return null;
  // A moderately wrong scale still peaks within a few pixels of the right spot, so refine scale locally around it.
  const at = (s: number): ScaledMatch | null => {
    const match = matchTemplate(pyramid, template, first.x, first.y, angle, s, 12);
    // The small window can't judge uniqueness; keep the margin from the full-window search.
    return match && { ...match, shift: Math.hypot(match.x - cx, match.y - cy), margin: first.margin, scale: s };
  };
  const better = (a: ScaledMatch | null, b: ScaledMatch | null) => (b && (!a || b.score > a.score) ? b : a);
  const step = 1.19;
  let best: ScaledMatch | null = { ...first, scale };
  const up = at(scale * step);
  const down = at(scale / step);
  const direction = (up?.score ?? -1) >= (down?.score ?? -1) ? step : 1 / step;
  let next = direction > 1 ? up : down;
  let current = scale * direction;
  for (let i = 0; i < 2 && next && next.score > (best?.score ?? -1); i += 1) {
    best = next;
    current *= direction;
    next = at(current);
  }
  best = better(best, next);
  if (!best) return null;
  const fine = Math.sqrt(step);
  return better(better(best, at(best.scale * fine)), at(best.scale / fine));
}

function matchAtLevel(
  image: GrayImage,
  template: Template,
  cx: number,
  cy: number,
  angle: number,
  scale: number,
  radius: number,
): MatchResult | null {
  const t = template.size;
  const reach = Math.ceil(radius / scale);
  const size = t + 2 * reach;
  const region = rectify(image, cx, cy, size, angle, scale);
  if (!region) return null;

  // Integral images for fast windowed mean and variance.
  const stride = size + 1;
  const sum = new Float64Array(stride * stride);
  const sumSq = new Float64Array(stride * stride);
  for (let y = 0; y < size; y += 1) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < size; x += 1) {
      const value = region[y * size + x];
      rowSum += value;
      rowSq += value * value;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + rowSum;
      sumSq[(y + 1) * stride + x + 1] = sumSq[y * stride + x + 1] + rowSq;
    }
  }
  const n = t * t;
  const score = (ox: number, oy: number) => {
    const a = oy * stride + ox;
    const b = oy * stride + ox + t;
    const c = (oy + t) * stride + ox;
    const d = (oy + t) * stride + ox + t;
    const s = sum[d] - sum[b] - sum[c] + sum[a];
    const sq = sumSq[d] - sumSq[b] - sumSq[c] + sumSq[a];
    const variance = sq - (s * s) / n;
    if (variance <= 1e-6) return -1;
    let dot = 0;
    for (let v = 0; v < t; v += 1) {
      const rowOffset = (oy + v) * size + ox;
      const tRow = v * t;
      for (let u = 0; u < t; u += 1) dot += region[rowOffset + u] * template.data[tRow + u];
    }
    return dot / (Math.sqrt(variance) * template.norm);
  };

  let best = { ox: reach, oy: reach, value: -Infinity };
  const span = 2 * reach;
  const coarseScores: Array<{ ox: number; oy: number; value: number }> = [];
  for (let oy = 0; oy <= span; oy += 3) {
    for (let ox = 0; ox <= span; ox += 3) {
      const value = score(ox, oy);
      coarseScores.push({ ox, oy, value });
      if (value > best.value) best = { ox, oy, value };
    }
  }
  const coarse = best;
  // Uniqueness: the best alternative away from the peak must be clearly worse, or the texture is ambiguous.
  const exclusion = Math.max(6, t / 3);
  let runnerUp = -Infinity;
  for (const s of coarseScores) {
    if (Math.hypot(s.ox - coarse.ox, s.oy - coarse.oy) > exclusion && s.value > runnerUp) runnerUp = s.value;
  }
  for (let oy = Math.max(0, coarse.oy - 3); oy <= Math.min(span, coarse.oy + 3); oy += 1) {
    for (let ox = Math.max(0, coarse.ox - 3); ox <= Math.min(span, coarse.ox + 3); ox += 1) {
      const value = score(ox, oy);
      if (value > best.value) best = { ox, oy, value };
    }
  }
  // A peak on the window border usually means the true match is outside it.
  if (best.ox === 0 || best.oy === 0 || best.ox === span || best.oy === span) return null;

  const du = best.ox - reach;
  const dv = best.oy - reach;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  const dx = cos * du - sin * dv;
  const dy = sin * du + cos * dv;
  return { x: cx + dx, y: cy + dy, score: best.value, shift: Math.hypot(dx, dy), margin: best.value - runnerUp };
}
