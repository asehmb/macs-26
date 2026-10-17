import type { GuidanceMode, Role } from "../../../shared/src/types";

const MAX_SAMPLES = 5000;
const TRIALS_KEY = "realitycheck.trials.v1";

export type StatsSummary = {
  frames: number;
  trackingFps: number;
  detectMs: number;
  lostPercent: number;
  errorPxMean: number | null;
  errorPxP95: number | null;
  errorMmMean: number | null;
  errorMmP95: number | null;
  referenceSamples: number;
  latencyMedianMs: number | null;
  latencyP95Ms: number | null;
  latencySamples: number;
};

export type TrialRow = {
  timestamp: string;
  trial: number;
  condition: GuidanceMode;
  recordedOn: Role;
  devicePresenter: string;
  deviceHelper: string;
  browser: string;
  lighting: string;
  taskSeconds: number | null;
  clarifications: number;
  trackingFps: number;
  detectMs: number;
  lostFramePercent: number;
  trackingErrorMeanPx: number | null;
  trackingErrorP95Px: number | null;
  trackingErrorMeanMm: number | null;
  trackingErrorP95Mm: number | null;
  syncLatencyMedianMs: number | null;
  verificationRatio: number | null;
  notes: string;
};

function push(list: number[], value: number) {
  list.push(value);
  if (list.length > MAX_SAMPLES) list.shift();
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

export class StatsRecorder {
  private frames = 0;
  private lostFrames = 0;
  private detectMs: number[] = [];
  private errorPx: number[] = [];
  private errorMm: number[] = [];
  private latencies: number[] = [];
  private firstFrameAt: number | null = null;
  private lastFrameAt: number | null = null;

  reset() {
    this.frames = 0;
    this.lostFrames = 0;
    this.detectMs = [];
    this.errorPx = [];
    this.errorMm = [];
    this.latencies = [];
    this.firstFrameAt = null;
    this.lastFrameAt = null;
  }

  recordFrame(time: number, detectMs: number, lost: boolean, reference: { errorPx: number; errorMm: number } | null) {
    this.frames += 1;
    if (lost) this.lostFrames += 1;
    this.firstFrameAt ??= time;
    this.lastFrameAt = time;
    push(this.detectMs, detectMs);
    if (reference) {
      push(this.errorPx, reference.errorPx);
      push(this.errorMm, reference.errorMm);
    }
  }

  recordLatency(ms: number) {
    push(this.latencies, ms);
  }

  summary(): StatsSummary {
    const span = this.firstFrameAt !== null && this.lastFrameAt !== null ? this.lastFrameAt - this.firstFrameAt : 0;
    return {
      frames: this.frames,
      trackingFps: span > 0 ? ((this.frames - 1) * 1000) / span : 0,
      detectMs: mean(this.detectMs.slice(-60)) ?? 0,
      lostPercent: this.frames ? (100 * this.lostFrames) / this.frames : 0,
      errorPxMean: mean(this.errorPx),
      errorPxP95: percentile(this.errorPx, 0.95),
      errorMmMean: mean(this.errorMm),
      errorMmP95: percentile(this.errorMm, 0.95),
      referenceSamples: this.errorPx.length,
      latencyMedianMs: percentile(this.latencies, 0.5),
      latencyP95Ms: percentile(this.latencies, 0.95),
      latencySamples: this.latencies.length,
    };
  }
}

export function loadTrials(): TrialRow[] {
  try {
    const raw = localStorage.getItem(TRIALS_KEY);
    return raw ? (JSON.parse(raw) as TrialRow[]) : [];
  } catch {
    return [];
  }
}

export function saveTrials(trials: TrialRow[]) {
  localStorage.setItem(TRIALS_KEY, JSON.stringify(trials));
}

export function appendTrial(trial: TrialRow) {
  saveTrials([...loadTrials(), trial]);
}

const CSV_COLUMNS: Array<[keyof TrialRow, string]> = [
  ["timestamp", "timestamp"],
  ["trial", "trial"],
  ["condition", "condition"],
  ["recordedOn", "recorded_on"],
  ["devicePresenter", "device_presenter"],
  ["deviceHelper", "device_helper"],
  ["browser", "browser"],
  ["lighting", "lighting"],
  ["taskSeconds", "task_seconds"],
  ["clarifications", "clarifications"],
  ["trackingFps", "tracking_fps"],
  ["detectMs", "detect_ms"],
  ["lostFramePercent", "lost_frame_percent"],
  ["trackingErrorMeanPx", "tracking_error_mean_px"],
  ["trackingErrorP95Px", "tracking_error_p95_px"],
  ["trackingErrorMeanMm", "tracking_error_mean_mm"],
  ["trackingErrorP95Mm", "tracking_error_p95_mm"],
  ["syncLatencyMedianMs", "sync_latency_median_ms"],
  ["verificationRatio", "verification_ratio"],
  ["notes", "notes"],
];

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function trialsToCsv(trials: TrialRow[]) {
  const header = CSV_COLUMNS.map(([, name]) => name).join(",");
  const rows = trials.map((trial) => CSV_COLUMNS.map(([key]) => csvCell(trial[key])).join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function downloadCsv(trials: TrialRow[]) {
  const blob = new Blob([trialsToCsv(trials)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `realitycheck-trials-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function shortBrowser() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "Other";
  const browser = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Edg/.test(ua) ? "Edge" : /Safari/.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}
