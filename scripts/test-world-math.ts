import {
  cameraToWorld,
  pickByNearbyPoints,
  pickDepth,
  projectWorldPoint,
  resolveAnchoredPosition,
  worldToCamera,
  type Reality,
} from "../client/src/world/xr8.ts";
import { decodeCells, tagCells } from "../client/src/world/frameTag.ts";

let failed = 0;
function check(name: string, actual: { x: number; y: number; z?: number }, expected: { x: number; y: number; z?: number }) {
  const err = Math.hypot(actual.x - expected.x, actual.y - expected.y, (actual.z ?? 0) - (expected.z ?? 0));
  const ok = err < 1e-6;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
}

const s = Math.SQRT1_2;
const origin = { x: 0, y: 0, z: 0 };

check("identity: point ahead stays ahead", worldToCamera({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: origin }, { x: 0, y: 0, z: -1 }), {
  x: 0,
  y: 0,
  z: -1,
});
check("yaw +90deg: camera looks down -X", worldToCamera({ rotation: { w: s, x: 0, y: s, z: 0 }, position: origin }, { x: -1, y: 0, z: 0 }), {
  x: 0,
  y: 0,
  z: -1,
});
check("pitch +90deg: camera looks up", worldToCamera({ rotation: { w: s, x: s, y: 0, z: 0 }, position: origin }, { x: 0, y: 1, z: 0 }), {
  x: 0,
  y: 0,
  z: -1,
});
check(
  "translation is removed first",
  worldToCamera({ rotation: { w: 1, x: 0, y: 0, z: 0 }, position: { x: 1, y: 2, z: 3 } }, { x: 1, y: 2, z: 2 }),
  { x: 0, y: 0, z: -1 },
);

// Symmetric perspective, 90deg vertical FOV, square aspect (column-major, as three.js/8th Wall provide).
const near = 0.01;
const far = 1000;
const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, (-2 * far * near) / (far - near), 0];
const reality: Reality = {
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  position: origin,
  intrinsics: perspective,
  trackingStatus: "NORMAL",
  trackingReason: "UNSPECIFIED",
};
const center = projectWorldPoint(reality, { x: 0, y: 0, z: -2 }, 400, 400)!;
check("centre projects to canvas centre", center, { x: 200, y: 200 });
const upRight = projectWorldPoint(reality, { x: 1, y: 1, z: -1 }, 400, 400)!;
check("45deg up-right hits top-right corner", upRight, { x: 400, y: 0 });
console.log(projectWorldPoint(reality, { x: 0, y: 0, z: 1 }, 400, 400) === null ? "PASS behind camera is hidden" : (failed++, "FAIL behind camera"));

// Round trip and depth pick with a rotated, translated camera.
const posed: Reality = { ...reality, rotation: { w: s, x: 0, y: s, z: 0 }, position: { x: 0.3, y: 1.2, z: -0.5 } };
const target = { x: -1.2, y: 1.0, z: -0.4 };
check("cameraToWorld inverts worldToCamera", cameraToWorld(posed, worldToCamera(posed, target)), target);
const tapAt = projectWorldPoint(posed, target, 400, 400)!;
const ray = { x: target.x - posed.position.x, y: target.y - posed.position.y, z: target.z - posed.position.z };
const along = (k: number, lift = 0) => ({
  x: posed.position.x + ray.x * k,
  y: posed.position.y + ray.y * k + lift,
  z: posed.position.z + ray.z * k,
});
posed.worldPoints = [0.97, 0.99, 1, 1.01, 1.03].map((k, i) => ({ id: i, confidence: 1, position: along(k, (i - 2) * 0.005) }));
posed.worldPoints.push({ id: 99, confidence: 1, position: along(3) }); // background point on the same ray
const pick = pickByNearbyPoints(posed, tapAt, 400, 400, 60);
const pickError = pick ? Math.hypot(pick.position.x - target.x, pick.position.y - target.y, pick.position.z - target.z) : Infinity;
console.log(`${pickError < 0.03 ? "PASS" : (failed++, "FAIL")} depth pick lands on target (error ${pickError.toFixed(4)}, support ${pick?.support})`);

// The map gets rescaled by 10% about the origin after placement: an anchored pin follows its points.
if (pick) {
  const rescaled = posed.worldPoints.map((p) => ({ ...p, position: { x: p.position.x * 1.1, y: p.position.y * 1.1, z: p.position.z * 1.1 } }));
  const followed = resolveAnchoredPosition(pick.anchors, rescaled)!;
  const expected = { x: target.x * 1.1, y: target.y * 1.1, z: target.z * 1.1 };
  const followError = Math.hypot(followed.position.x - expected.x, followed.position.y - expected.y, followed.position.z - expected.z);
  console.log(`${followError < 0.03 ? "PASS" : (failed++, "FAIL")} anchored pin follows a rescaled map (error ${followError.toFixed(4)}, live ${followed.live})`);
}

// Plain desk: camera 0.5 above the desk (y = 0), pitched down 45deg; no map points within ~0.2 of the tap, a few
// points on an object standing on the desk. The tap at the centre should land on the desk 0.5 ahead.
{
  const half = Math.PI / 8;
  const desk: Reality = { ...reality, rotation: { w: Math.cos(-half), x: Math.sin(-half), y: 0, z: 0 }, position: { x: 0, y: 0.5, z: 0 } };
  const deskTarget = { x: 0, y: 0, z: -0.5 };
  let seed = 7;
  const noise = () => ((seed = (seed * 48271) % 2147483647) / 2147483647 - 0.5) * 0.006;
  const points: Reality["worldPoints"] = [];
  for (let x = -0.4; x <= 0.4001; x += 0.05) {
    for (let z = -0.9; z <= -0.1; z += 0.05) {
      if (Math.hypot(x, z + 0.5) < 0.2) continue;
      points.push({ id: points.length, confidence: 1, position: { x, y: noise(), z } });
    }
  }
  for (let i = 0; i < 6; i += 1) points.push({ id: 1000 + i, confidence: 1, position: { x: 0.22 + i * 0.01, y: 0.1 + i * 0.02, z: -0.55 } });
  desk.worldPoints = points;
  const tap = projectWorldPoint(desk, deskTarget, 400, 400)!;
  const nearest = Math.min(...points.map((p) => {
    const at = projectWorldPoint(desk, p.position, 400, 400);
    return at ? Math.hypot(at.x - tap.x, at.y - tap.y) : Infinity;
  }));
  const plane = pickDepth(desk, tap, 400, 400);
  const planeError = plane ? Math.hypot(plane.position.x - deskTarget.x, plane.position.y - deskTarget.y, plane.position.z - deskTarget.z) : Infinity;
  console.log(
    `${plane?.kind === "plane" && planeError < 0.01 ? "PASS" : (failed++, "FAIL")} plain desk: plane pick lands on the desk (kind ${plane?.kind}, error ${planeError.toFixed(4)}, nearest point ${nearest.toFixed(0)} px, ${plane?.support} inliers)`,
  );
  const textured = pickDepth(posed, tapAt, 400, 400);
  console.log(`${textured?.kind === "median" ? "PASS" : (failed++, "FAIL")} textured spot still uses the median pick`);
}

// Frame tags survive compression-like brightness errors.
for (const frame of [0, 1, 1234, 4095, 4096 + 17]) {
  const luma = tagCells(frame).map((on, i) => (on ? 220 : 35) + ((i * 37) % 50) - 25);
  const decoded = decodeCells(luma);
  console.log(`${decoded === frame % 4096 ? "PASS" : (failed++, "FAIL")} frame tag ${frame} decodes as ${decoded}`);
}
{
  const luma = tagCells(1234).map((on) => (on ? 220 : 35));
  luma[5] = luma[5] > 128 ? 35 : 220;
  console.log(`${decodeCells(luma) === null ? "PASS" : (failed++, "FAIL")} a flipped tag bit is rejected by parity`);
}

if (failed) {
  console.error(`${failed} world math check(s) failed`);
  process.exit(1);
}
console.log("All world math checks passed");
