export type MarkerSpec = {
  id: number;
  x: number;
  y: number;
  size: number;
  role: "corner" | "reference";
};

export type Rect = { x: number; y: number; width: number; height: number };

export const ARUCO_DICTIONARY = "ARUCO_MIP_36h12";

/** The dictionary's minimum code distance is 12, so up to 5 bit errors can be corrected unambiguously. */
export const MAX_HAMMING_DISTANCE = 6;

/** Board coordinates in millimetres; sized to fit both Letter and A4 at 100% scale. */
export const BOARD = { width: 190, height: 260 };

export const MARKERS: MarkerSpec[] = [
  { id: 10, x: 5, y: 5, size: 40, role: "corner" },
  { id: 11, x: 145, y: 5, size: 40, role: "corner" },
  { id: 12, x: 145, y: 215, size: 40, role: "corner" },
  { id: 13, x: 5, y: 215, size: 40, role: "corner" },
  { id: 20, x: 80, y: 5, size: 30, role: "reference" },
];

export const REFERENCE_MARKER_ID = 20;

export const TEST_DOT = { x: 95, y: 130 };

export const SCALE_BAR = { x: 45, y: 180, length: 100 };

export const VERIFY_ZONE: Rect = { x: 55, y: 195, width: 80, height: 55 };

export const MARKER_BY_ID = new Map(MARKERS.map((marker) => [marker.id, marker]));

/** Outer black-square corners in detector order: top-left, top-right, bottom-right, bottom-left. */
export function markerCornersMm(marker: MarkerSpec) {
  const { x, y, size } = marker;
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

export function markerCenterMm(marker: MarkerSpec) {
  return { x: marker.x + marker.size / 2, y: marker.y + marker.size / 2 };
}
