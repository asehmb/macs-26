type Point = { x: number; y: number };

export type Homography = [number, number, number, number, number, number, number, number, number];

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) {
        pivot = j;
      }
    }
    if (Math.abs(a[pivot][i]) < 1e-9) {
      return null;
    }
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const div = a[i][i];
    for (let k = i; k < n; k += 1) {
      a[i][k] /= div;
    }
    b[i] /= div;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const factor = a[j][i];
      for (let k = i; k < n; k += 1) {
        a[j][k] -= factor * a[i][k];
      }
      b[j] -= factor * b[i];
    }
  }
  return b;
}

export function computeHomography(source: Point[], target: Point[]): Homography | null {
  if (source.length < 4 || target.length < 4) {
    return null;
  }
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const s = source[i];
    const t = target[i];
    a.push([s.x, s.y, 1, 0, 0, 0, -s.x * t.x, -s.y * t.x]);
    b.push(t.x);
    a.push([0, 0, 0, s.x, s.y, 1, -s.x * t.y, -s.y * t.y]);
    b.push(t.y);
  }
  const h = solveLinearSystem(a, b);
  if (!h) {
    return null;
  }
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function projectPoint(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function invertHomography(m: Homography): Homography | null {
  const [
    a, b, c,
    d, e, f,
    g, h, i,
  ] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) {
    return null;
  }
  const inv: Homography = [
    A / det, D / det, G / det,
    B / det, E / det, H / det,
    C / det, F / det, I / det,
  ];
  return inv;
}
