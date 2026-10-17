class LowPass {
  private value: number | null = null;

  filter(input: number, alpha: number) {
    this.value = this.value === null ? input : alpha * input + (1 - alpha) * this.value;
    return this.value;
  }

  last() {
    return this.value;
  }
}

function smoothingFactor(cutoffHz: number, dtSec: number) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/** One Euro filter (Casiez et al., 2012): low jitter when still, low lag when moving. */
export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime: number | null = null;

  constructor(
    private minCutoff = 1.5,
    private beta = 0.05,
    private derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number) {
    const prev = this.x.last();
    if (this.lastTime === null || prev === null) {
      this.lastTime = timeMs;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, (timeMs - this.lastTime) / 1000);
    this.lastTime = timeMs;
    const derivative = this.dx.filter((value - prev) / dt, smoothingFactor(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(derivative);
    return this.x.filter(value, smoothingFactor(cutoff, dt));
  }
}
