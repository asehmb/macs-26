import { useState } from "react";
import { v4 as uuid } from "uuid";
import type { Role, Step } from "../../../shared/src/types";
import { useRoomStore } from "../state/room";

const DEMO_STEPS = ["Find the marked component", "Place the part in the zone", "Confirm alignment"];

export function StepsPanel({ role }: { role: Role }) {
  const state = useRoomStore((s) => s.state);
  const [draft, setDraft] = useState("");
  if (!state) return null;
  const { steps, currentStepId, annotations } = state;
  const actions = useRoomStore.getState();
  const index = steps.findIndex((step) => step.id === currentStepId);
  const done = steps.filter((step) => step.completed).length;

  const addStep = () => {
    const title = draft.trim();
    if (!title) return;
    actions.setSteps([...steps, { id: uuid(), title, completed: false }]);
    setDraft("");
  };

  const removeStep = (step: Step) => actions.setSteps(steps.filter((item) => item.id !== step.id));

  return (
    <details className="panel" open>
      <summary>
        Steps {steps.length > 0 && <span className="muted">· {done}/{steps.length} done</span>}
      </summary>
      {steps.length === 0 ? (
        <p className="muted">No steps yet. Annotations are shown all the time until steps are added.</p>
      ) : (
        <>
          <div className="step-progress">
            <strong>
              Step {index + 1} of {steps.length}
            </strong>
            <span>{steps[index]?.title}</span>
          </div>
          <div className="row">
            <button type="button" disabled={index <= 0} onClick={() => actions.goToStep(steps[index - 1].id)}>
              Previous
            </button>
            <button
              type="button"
              disabled={index < 0 || index >= steps.length - 1}
              onClick={() => actions.goToStep(steps[index + 1].id)}
            >
              Next
            </button>
          </div>
          <ol className="list">
            {steps.map((step) => (
              <li key={step.id} className={step.id === currentStepId ? "current" : undefined}>
                <input
                  type="checkbox"
                  aria-label={`Mark ${step.title} complete`}
                  checked={step.completed}
                  onChange={(event) => actions.setStepCompleted(step.id, event.target.checked)}
                />
                <button type="button" className="link" onClick={() => actions.goToStep(step.id)}>
                  {step.title}
                </button>
                <span className="muted">{annotations.filter((a) => a.stepId === step.id).length} notes</span>
                {role === "helper" && (
                  <button type="button" className="ghost small" onClick={() => removeStep(step)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {role === "helper" && (
        <>
          <div className="row">
            <input
              value={draft}
              placeholder="New step title"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addStep()}
            />
            <button type="button" onClick={addStep}>
              Add
            </button>
          </div>
          {steps.length === 0 && (
            <button
              type="button"
              className="ghost"
              onClick={() => actions.setSteps(DEMO_STEPS.map((title) => ({ id: uuid(), title, completed: false })))}
            >
              Load demo steps
            </button>
          )}
        </>
      )}
    </details>
  );
}
