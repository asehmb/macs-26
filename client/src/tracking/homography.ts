export type Point = { x: number; y: number };

/** Row-major 3x3 matrix mapping source points to destination points. */
export type Homography = number[];

function multiply(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function invertHomography(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return null;
  }
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function projectPoint(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function scaleHomography(h: Homography, sx: number, sy: number): Homography {
  return multiply([sx, 0, 0, 0, sy, 0, 0, 0, 1], h);
}

function normalization(points: Point[]) {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let meanDist = 0;
  for (const p of points) {
    meanDist += Math.hypot(p.x - cx, p.y - cy);
  }
  meanDist /= points.length;
  const s = meanDist > 0 ? Math.SQRT2 / meanDist : 1;
  return {
    matrix: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1] as Homography,
    inverse: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1] as Homography,
    points: points.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) })),
  };
}

function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    }
    if (Math.abs(a[pivot][i]) < 1e-12) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let j = i + 1; j < n; j += 1) {
      const factor = a[j][i] / a[i][i];
      for (let k = i; k < n; k += 1) a[j][k] -= factor * a[i][k];
      b[j] -= factor * b[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let k = i + 1; k < n; k += 1) sum -= a[i][k] * x[k];
    x[i] = sum / a[i][i];
  }
  return x;
}

/** Normalized DLT least-squares fit over all correspondences (needs at least 4). */
export function computeHomography(source: Point[], target: Point[]): Homography | null {
  if (source.length < 4 || source.length !== target.length) {
    return null;
  }
  const src = normalization(source);
  const dst = normalization(target);
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const atb = new Array<number>(8).fill(0);

  const accumulate = (row: number[], value: number) => {
    for (let r = 0; r < 8; r += 1) {
      if (row[r] === 0) continue;
      atb[r] += row[r] * value;
      for (let c = 0; c < 8; c += 1) ata[r][c] += row[r] * row[c];
    }
  };

  for (let i = 0; i < src.points.length; i += 1) {
    const { x, y } = src.points[i];
    const { x: u, y: v } = dst.points[i];
    accumulate([x, y, 1, 0, 0, 0, -x * u, -y * u], u);
    accumulate([0, 0, 0, x, y, 1, -x * v, -y * v], v);
  }

  const h = solve(ata, atb);
  if (!h || h.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const denormalized = multiply(dst.inverse, multiply([...h, 1], src.matrix));
  const scale = denormalized[8];
  if (Math.abs(scale) < 1e-12) return null;
  return denormalized.map((value) => value / scale);
}

export function reprojectionRms(h: Homography, source: Point[], target: Point[]): number {
  let sum = 0;
  for (let i = 0; i < source.length; i += 1) {
    const p = projectPoint(h, source[i]);
    sum += (p.x - target[i].x) ** 2 + (p.y - target[i].y) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, source.length));
}
