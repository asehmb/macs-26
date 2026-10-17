import { useState } from "react";
import { Link } from "react-router-dom";
import { downloadCsv, loadTrials, saveTrials, type TrialRow } from "../state/bench";

const fmt = (value: number | null, digits = 1) => (value === null || value === undefined ? "-" : value.toFixed(digits));

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(trials: TrialRow[]) {
  const times = trials.map((t) => t.taskSeconds).filter((v): v is number => v !== null);
  const clarifications = trials.map((t) => t.clarifications);
  return {
    count: trials.length,
    medianSeconds: median(times),
    minSeconds: times.length ? Math.min(...times) : null,
    maxSeconds: times.length ? Math.max(...times) : null,
    medianClarifications: median(clarifications),
  };
}

export function Bench() {
  const [trials, setTrials] = useState<TrialRow[]>(loadTrials);
  const update = (next: TrialRow[]) => {
    saveTrials(next);
    setTrials(next);
  };
  const conditions = [
    { id: "baseline", label: "Baseline (video + voice)" },
    { id: "guided", label: "RealityCheck (anchored guidance)" },
  ] as const;

  return (
    <main className="page wide">
      <h1>Benchmark trials</h1>
      <p className="muted">
        Trials are saved in this browser when you press Save trial in a room. Only measured runs appear here.
      </p>

      <section className="card">
        <h2>Summary</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Condition</th>
              <th>Trials</th>
              <th>Median time (s)</th>
              <th>Range (s)</th>
              <th>Median clarifications</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((condition) => {
              const s = summarize(trials.filter((t) => t.condition === condition.id));
              return (
                <tr key={condition.id}>
                  <td>{condition.label}</td>
                  <td>{s.count}</td>
                  <td>{fmt(s.medianSeconds)}</td>
                  <td>{s.minSeconds === null ? "-" : `${fmt(s.minSeconds)}–${fmt(s.maxSeconds)}`}</td>
                  <td>{fmt(s.medianClarifications, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="row">
          <button type="button" disabled={!trials.length} onClick={() => downloadCsv(trials)}>
            Export CSV
          </button>
          <button
            type="button"
            className="danger"
            disabled={!trials.length}
            onClick={() => window.confirm("Delete all saved trials in this browser?") && update([])}
          >
            Delete all
          </button>
          <Link to="/">Home</Link>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Condition</th>
                <th>On</th>
                <th>Time (s)</th>
                <th>Clarif.</th>
                <th>Err px (mean/p95)</th>
                <th>Err mm (mean/p95)</th>
                <th>Lost %</th>
                <th>FPS</th>
                <th>Sync ms</th>
                <th>Devices</th>
                <th>Lighting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trials.map((trial, index) => (
                <tr key={`${trial.timestamp}-${index}`}>
                  <td>{trial.trial}</td>
                  <td>{trial.condition}</td>
                  <td>{trial.recordedOn}</td>
                  <td>{fmt(trial.taskSeconds)}</td>
                  <td>{trial.clarifications}</td>
                  <td>
                    {fmt(trial.trackingErrorMeanPx)} / {fmt(trial.trackingErrorP95Px)}
                  </td>
                  <td>
                    {fmt(trial.trackingErrorMeanMm, 2)} / {fmt(trial.trackingErrorP95Mm, 2)}
                  </td>
                  <td>{fmt(trial.lostFramePercent)}</td>
                  <td>{fmt(trial.trackingFps)}</td>
                  <td>{fmt(trial.syncLatencyMedianMs, 0)}</td>
                  <td>
                    {trial.devicePresenter || "?"} → {trial.deviceHelper || "?"}
                  </td>
                  <td>{trial.lighting}</td>
                  <td>
                    <button type="button" className="ghost small" onClick={() => update(trials.filter((_, i) => i !== index))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
