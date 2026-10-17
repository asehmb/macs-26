declare module "js-aruco2" {
  export class Detector {
    constructor(dictionaryName?: string);
    detect(imageData: ImageData): Marker[];
  }

  export type Corner = {
    x: number;
    y: number;
  };

  export type Marker = {
    id: number;
    corners: Corner[];
  };

  export const AR: {
    Detector: new (config?: { dictionaryName?: string }) => Detector;
  };

  const ARModule: {
    AR: {
      Detector: new (config?: { dictionaryName?: string }) => Detector;
    };
  };
  export = ARModule;
}
