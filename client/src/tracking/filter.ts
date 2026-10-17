export class LowPassFilter {
  private value: number | null = null;

  apply(input: number, alpha: number): number {
    if (this.value === null) {
      this.value = input;
      return input;
    }
    this.value = alpha * input + (1 - alpha) * this.value;
    return this.value;
  }

  reset() {
    this.value = null;
  }
}

export class PointFilter {
  private x = new LowPassFilter();
  private y = new LowPassFilter();

  apply(point: { x: number; y: number }, alpha = 0.55) {
    return {
      x: this.x.apply(point.x, alpha),
      y: this.y.apply(point.y, alpha),
    };
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }
}
