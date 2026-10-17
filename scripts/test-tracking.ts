import jsAruco from "js-aruco2";
import {
  ARUCO_DICTIONARY,
  MAX_HAMMING_DISTANCE,
  BOARD,
  MARKERS,
  TEST_DOT,
  VERIFY_ZONE,
} from "../shared/src/target-layout.ts";
import { computeHomography, invertHomography, projectPoint, type Homography } from "../client/src/tracking/homography.ts";
import { TargetTracker } from "../client/src/tracking/tracker.ts";

const WIDTH = 960;
const HEIGHT = 720;
const dictionary = new jsAruco.AR.Dictionary(ARUCO_DICTIONARY);

function boardIntensity(x: number, y: number): number {
  if (x < 0 || y < 0 || x > BOARD.width || y > BOARD.height) return 90;
  for (const marker of MARKERS) {
    const u = x - marker.x;
    const v = y - marker.y;
    if (u < 0 || v < 0 || u >= marker.size || v >= marker.size) continue;
    const bits: string = dictionary.codeList[marker.id];
    const n = Math.sqrt(bits.length);
    const cell = marker.size / (n + 2);
    const col = Math.floor(u / cell) - 1;
    const row = Math.floor(v / cell) - 1;
    if (col < 0 || row < 0 || col >= n || row >= n) return 0;
    return bits[row * n + col] === "1" ? 255 : 0;
  }
  return 245;
}

function render(boardToImage: Homography, occlude?: (x: number, y: number) => boolean) {
  const imageToBoard = invertHomography(boardToImage)!;
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const offsets = [0.25, 0.75];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let sum = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const p = projectPoint(imageToBoard, { x: x + ox, y: y + oy });
          sum += boardIntensity(p.x, p.y);
        }
      }
      const value = occlude?.(x, y) ? 120 : sum / 4;
      const i = (y * WIDTH + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function pose(quad: Array<[number, number]>): Homography {
  const boardCorners = [
    { x: 0, y: 0 },
    { x: BOARD.width, y: 0 },
    { x: BOARD.width, y: BOARD.height },
    { x: 0, y: BOARD.height },
  ];
  return computeHomography(boardCorners, quad.map(([x, y]) => ({ x, y })))!;
}

const cases: Array<{ name: string; truth: Homography; occlude?: (x: number, y: number) => boolean; minMarkers: number }> = [
  { name: "frontal", truth: pose([[300, 80], [740, 80], [740, 680], [300, 680]]), minMarkers: 5 },
  { name: "rotated 90deg", truth: pose([[880, 140], [880, 580], [280, 580], [280, 140]]), minMarkers: 5 },
  { name: "rotated 180deg", truth: pose([[740, 680], [300, 680], [300, 80], [740, 80]]), minMarkers: 5 },
  { name: "perspective tilt", truth: pose([[340, 120], [690, 90], [800, 690], [220, 660]]), minMarkers: 5 },
  {
    name: "two markers occluded",
    truth: pose([[300, 80], [740, 80], [740, 680], [300, 680]]),
    occlude: (x, y) => y > 380,
    minMarkers: 2,
  },
];

const probes = [
  TEST_DOT,
  { x: VERIFY_ZONE.x + VERIFY_ZONE.width / 2, y: VERIFY_ZONE.y + VERIFY_ZONE.height / 2 },
  { x: 20, y: 120 },
];

const detector = new jsAruco.AR.Detector({
  dictionaryName: ARUCO_DICTIONARY,
  maxHammingDistance: MAX_HAMMING_DISTANCE,
});
let failures = 0;

for (const testCase of cases) {
  const image = render(testCase.truth, testCase.occlude);
  const markers = detector.detect(image);
  const tracker = new TargetTracker();
  const frame = tracker.update(markers, 0);
  const ids = markers.map((m: { id: number }) => m.id).sort((a: number, b: number) => a - b);

  let maxError = Infinity;
  if (frame.homography) {
    maxError = Math.max(
      ...probes.map((probe) => {
        const estimated = projectPoint(frame.homography!, probe);
        const truth = projectPoint(testCase.truth, probe);
        return Math.hypot(estimated.x - truth.x, estimated.y - truth.y);
      }),
    );
  }
  const passed = frame.status === "ok" && markers.length >= testCase.minMarkers && maxError < 3;
  if (!passed) failures += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${testCase.name}: markers=[${ids.join(",")}] status=${frame.status} ` +
      `maxProbeError=${maxError.toFixed(2)}px reprojection=${frame.reprojectionPx?.toFixed(2) ?? "-"}px ` +
      `reference=${frame.reference ? `${frame.reference.errorPx.toFixed(2)}px/${frame.reference.errorMm.toFixed(2)}mm` : "-"}`,
  );
}

const tracker = new TargetTracker();
const truth = cases[0].truth;
tracker.update(detector.detect(render(truth)), 0);
const blank = tracker.update([], 200);
const lost = tracker.update([], 400);
const lostOk = blank.status === "holding" && lost.status === "lost";
if (!lostOk) failures += 1;
console.log(`${lostOk ? "PASS" : "FAIL"} lost timeout: 200ms=${blank.status} 400ms=${lost.status}`);

if (failures > 0) {
  console.error(`${failures} tracking check(s) failed`);
  process.exit(1);
}
console.log("All tracking checks passed");
