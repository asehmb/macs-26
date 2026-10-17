import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Role } from "../../../shared/src/types";
import { appendTrial, loadTrials, shortBrowser, type StatsRecorder, type StatsSummary } from "../state/bench";
import { useRoomStore } from "../state/room";

type Props = {
  role: Role;
  recorder: StatsRecorder;
  verificationRatio: number | null;
};

const fmt = (value: number | null, digits = 1) => (value === null ? "-" : value.toFixed(digits));

const META_KEY = "realitycheck.bench-meta.v1";

type Meta = { devicePresenter: string; deviceHelper: string; lighting: string; notes: string };

function loadMeta(): Meta {
  try {
    return { devicePresenter: "", deviceHelper: "", lighting: "", notes: "", ...JSON.parse(localStorage.getItem(META_KEY) ?? "{}") };
  } catch {
    return { devicePresenter: "", deviceHelper: "", lighting: "", notes: "" };
  }
}

export function BenchPanel({ role, recorder, verificationRatio }: Props) {
  const mode = useRoomStore((s) => s.state?.mode ?? "guided");
  const [stats, setStats] = useState<StatsSummary>(() => recorder.summary());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [clarifications, setClarifications] = useState(0);
  const [meta, setMeta] = useState<Meta>(loadMeta);
  const [trial, setTrial] = useState(() => loadTrials().length + 1);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats(recorder.summary());
      setTick((value) => value + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, [recorder]);

  useEffect(() => {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }, [meta]);

  const elapsedMs = startedAt ? (stoppedAt ?? Date.now()) - startedAt : 0;
  const running = startedAt !== null && stoppedAt === null;

  const start = () => {
    recorder.reset();
    setStartedAt(Date.now());
    setStoppedAt(null);
    setClarifications(0);
    setSavedMessage(null);
  };

  const save = () => {
    const summary = recorder.summary();
    appendTrial({
      timestamp: new Date().toISOString(),
      trial,
      condition: mode,
      recordedOn: role,
      devicePresenter: meta.devicePresenter,
      deviceHelper: meta.deviceHelper,
      browser: shortBrowser(),
      lighting: meta.lighting,
      taskSeconds: startedAt ? elapsedMs / 1000 : null,
      clarifications,
      trackingFps: summary.trackingFps,
      detectMs: summary.detectMs,
      lostFramePercent: summary.lostPercent,
      trackingErrorMeanPx: summary.errorPxMean,
      trackingErrorP95Px: summary.errorPxP95,
      trackingErrorMeanMm: summary.errorMmMean,
      trackingErrorP95Mm: summary.errorMmP95,
      syncLatencyMedianMs: summary.latencyMedianMs,
      verificationRatio,
      notes: meta.notes,
    });
    setSavedMessage(`Saved trial ${trial} (${mode}).`);
    setTrial((value) => value + 1);
  };

  const field = (key: keyof Meta, label: string) => (
    <label>
      {label}
      <input value={meta[key]} onChange={(event) => setMeta({ ...meta, [key]: event.target.value })} />
    </label>
  );

  return (
    <details className="panel">
      <summary>
        Bench <span className="muted">· {mode === "baseline" ? "baseline (video + voice only)" : "guided"}</span>
      </summary>
      <div className="segmented" role="radiogroup" aria-label="Condition">
        <button type="button" className={mode === "guided" ? "active" : undefined} onClick={() => useRoomStore.getState().setMode("guided")}>
          Guided
        </button>
        <button type="button" className={mode === "baseline" ? "active" : undefined} onClick={() => useRoomStore.getState().setMode("baseline")}>
          Baseline
        </button>
      </div>

      <div className="timer">{(elapsedMs / 1000).toFixed(1)}s</div>
      <div className="row">
        {running ? (
          <button type="button" onClick={() => setStoppedAt(Date.now())}>
            Stop task
          </button>
        ) : (
          <button type="button" onClick={start}>
            Start task
          </button>
        )}
        <button type="button" className="ghost" onClick={() => setClarifications((value) => value + 1)}>
          Clarification +1 ({clarifications})
        </button>
        <button type="button" className="ghost small" disabled={clarifications === 0} onClick={() => setClarifications((value) => value - 1)}>
          -1
        </button>
      </div>

      <dl className="stats">
        <dt>Tracking</dt>
        <dd>
          {fmt(stats.trackingFps)} fps · {fmt(stats.detectMs)} ms/detect · {fmt(stats.lostPercent)}% lost
        </dd>
        <dt>Reference error</dt>
        <dd>
          mean {fmt(stats.errorPxMean)} px / {fmt(stats.errorMmMean, 2)} mm · p95 {fmt(stats.errorPxP95)} px /{" "}
          {fmt(stats.errorMmP95, 2)} mm <span className="muted">(n={stats.referenceSamples})</span>
        </dd>
        <dt>Annotation sync</dt>
        <dd>
          median {fmt(stats.latencyMedianMs, 0)} ms · p95 {fmt(stats.latencyP95Ms, 0)} ms{" "}
          <span className="muted">(n={stats.latencySamples})</span>
        </dd>
      </dl>

      <div className="form-grid">
        <label>
          Trial #
          <input type="number" min={1} value={trial} onChange={(event) => setTrial(Number(event.target.value) || 1)} />
        </label>
        {field("devicePresenter", "Presenter device")}
        {field("deviceHelper", "Helper device")}
        {field("lighting", "Lighting")}
        {field("notes", "Notes")}
      </div>
      <div className="row">
        <button type="button" onClick={save} disabled={running}>
          Save trial
        </button>
        <button type="button" className="ghost" onClick={() => recorder.reset()}>
          Reset stats
        </button>
        <Link to="/bench" target="_blank" rel="noreferrer">
          All trials
        </Link>
      </div>
      {savedMessage && <p className="muted">{savedMessage}</p>}
    </details>
  );
}
