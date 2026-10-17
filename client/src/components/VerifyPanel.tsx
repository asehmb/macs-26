import type { ColorPreset, Role, VerifyStatus } from "../../../shared/src/types";
import { useRoomStore } from "../state/room";

const LABELS: Record<VerifyStatus, string> = {
  aligned: "Aligned",
  not_yet: "Not yet",
  tracking_lost: "Tracking lost",
};

const COLORS: ColorPreset[] = ["blue", "green", "red", "yellow"];

type Props = {
  role: Role;
  local: { status: VerifyStatus; ratio: number } | null;
  showZone: boolean;
  onToggleZone: (value: boolean) => void;
};

export function VerifyPanel({ role, local, showZone, onToggleZone }: Props) {
  const state = useRoomStore((s) => s.state);
  const remote = useRoomStore((s) => s.verifyReport);
  if (!state) return null;
  const actions = useRoomStore.getState();
  const fresh = remote && Date.now() - remote.ts < 3000 ? remote : null;
  const report = role === "presenter" ? local : fresh;
  const currentStep = state.steps.find((step) => step.id === state.currentStepId);

  return (
    <details className="panel">
      <summary>
        Verification{" "}
        {report && <span className={`badge verify-${report.status}`}>{LABELS[report.status]}</span>}
      </summary>
      <p className="muted">
        The presenter's phone checks the printed "Place part here" box for a {state.verifyColor} part.
      </p>
      <div className="row">
        <label className="inline">
          Part colour
          <select value={state.verifyColor} onChange={(event) => actions.setVerifyColor(event.target.value as ColorPreset)}>
            {COLORS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={showZone} onChange={(event) => onToggleZone(event.target.checked)} />
          Show zone
        </label>
      </div>
      <p>
        Status: <strong>{report ? LABELS[report.status] : "No report from presenter"}</strong>
        {report && report.status !== "tracking_lost" && (
          <span className="muted"> · {(report.ratio * 100).toFixed(0)}% of zone matches</span>
        )}
      </p>
      {role === "helper" && (
        <button
          type="button"
          disabled={!currentStep}
          onClick={() => currentStep && actions.setStepCompleted(currentStep.id, true)}
        >
          {currentStep ? `Approve "${currentStep.title}"` : "Approve (add steps first)"}
        </button>
      )}
    </details>
  );
}
