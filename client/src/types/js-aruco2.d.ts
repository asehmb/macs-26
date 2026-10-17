declare module "js-aruco2" {
  type Corner = { x: number; y: number };
  type Marker = { id: number; corners: Corner[] };
  type Image = { width: number; height: number; data: Uint8ClampedArray | number[] };

  const jsAruco: {
    AR: {
      Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => {
        detect(image: Image): Marker[];
      };
      Dictionary: new (name: string) => { codeList: string[] };
    };
  };

  export default jsAruco;
}
