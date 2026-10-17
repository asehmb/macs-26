import type { Annotation } from "../../../shared/src/types";
import { useRoomStore } from "../state/room";

export type Tool = "pin" | "arrow" | "text" | "laser";

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: "pin", label: "Pin", hint: "Tap the object to drop a pin (uses the label below if filled in)." },
  { id: "arrow", label: "Arrow", hint: "Tap where the arrow starts, then where it points." },
  { id: "text", label: "Text", hint: "Type an instruction, then tap where it belongs." },
  { id: "laser", label: "Laser", hint: "Press and drag to point without leaving a mark." },
];

type Props = {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  draftText: string;
  onDraftTextChange: (text: string) => void;
  arrowPending: boolean;
};

export function HelperTools({ tool, onToolChange, draftText, onDraftTextChange, arrowPending }: Props) {
  const state = useRoomStore((s) => s.state);
  const actions = useRoomStore.getState();
  const annotations = state?.annotations ?? [];
  const stepTitle = (annotation: Annotation) =>
    state?.steps.find((step) => step.id === annotation.stepId)?.title ?? "All steps";

  return (
    <details className="panel" open>
      <summary>Annotate</summary>
      <div className="segmented" role="radiogroup" aria-label="Annotation tool">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={tool === item.id}
            className={tool === item.id ? "active" : undefined}
            onClick={() => onToolChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="muted">
        {arrowPending ? "Now tap where the arrow should point." : TOOLS.find((item) => item.id === tool)?.hint}
      </p>
      {tool !== "laser" && (
        <input
          value={draftText}
          maxLength={80}
          placeholder={tool === "text" ? "Instruction (required)" : "Label (optional)"}
          onChange={(event) => onDraftTextChange(event.target.value)}
        />
      )}
      {annotations.length > 0 && (
        <>
          <ul className="list">
            {annotations.map((annotation) => (
              <li key={annotation.id}>
                <span className="tag">{annotation.type}</span>
                <input
                  defaultValue={annotation.text ?? ""}
                  placeholder="(no label)"
                  aria-label="Annotation label"
                  onBlur={(event) => {
                    const text = event.target.value.trim();
                    if (text !== (annotation.text ?? "")) {
                      actions.updateAnnotation({ ...annotation, text: text || undefined, updatedAt: Date.now() });
                    }
                  }}
                />
                <span className="muted small-text">{stepTitle(annotation)}</span>
                <button type="button" className="ghost small" onClick={() => actions.deleteAnnotation(annotation.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="danger" onClick={() => actions.clearAnnotations()}>
            Clear all annotations
          </button>
        </>
      )}
    </details>
  );
}
