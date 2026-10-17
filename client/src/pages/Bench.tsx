import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clearBenchRows, downloadBenchCsv, getBenchRows } from "../state/bench";

export function Bench() {
  const [clarifications, setClarifications] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const rows = useMemo(() => getBenchRows(), [startedAt, stoppedAt, clarifications]);
  const elapsedMs = startedAt ? (stoppedAt ?? Date.now()) - startedAt : 0;

  return (
    <main className="page">
      <h1>Bench</h1>
      <div className="row">
        <button type="button" onClick={() => setStartedAt(Date.now())}>
          Start task timer
        </button>
        <button type="button" onClick={() => setStoppedAt(Date.now())}>
          Stop timer
        </button>
        <button
          type="button"
          onClick={() => setClarifications((value) => value + 1)}
        >
          Clarification +1
        </button>
      </div>
      <p>Elapsed: {(elapsedMs / 1000).toFixed(1)}s</p>
      <p>Clarifications: {clarifications}</p>
      <div className="row">
        <button type="button" onClick={downloadBenchCsv}>
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => {
            clearBenchRows();
            setClarifications(0);
            setStartedAt(null);
            setStoppedAt(null);
          }}
        >
          Clear bench data
        </button>
      </div>
      <pre className="log">{rows.map((row) => `${row.metric}: ${row.value} (${row.note})`).join("\n")}</pre>
      <Link to="/">Back to room setup</Link>
    </main>
  );
}
