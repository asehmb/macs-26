type Point = { x: number; y: number };

export type VideoBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export function computeVideoBox(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
): VideoBox {
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function videoToCanvasPoint(
  videoPoint: Point,
  box: VideoBox,
  mirrored: boolean,
  videoWidth: number,
): Point {
  const xInVideo = mirrored ? videoWidth - videoPoint.x : videoPoint.x;
  return {
    x: box.x + xInVideo * box.scale,
    y: box.y + videoPoint.y * box.scale,
  };
}

export function canvasToVideoPoint(
  canvasPoint: Point,
  box: VideoBox,
  mirrored: boolean,
  videoWidth: number,
): Point {
  const x = (canvasPoint.x - box.x) / box.scale;
  const y = (canvasPoint.y - box.y) / box.scale;
  return {
    x: mirrored ? videoWidth - x : x,
    y,
  };
}
