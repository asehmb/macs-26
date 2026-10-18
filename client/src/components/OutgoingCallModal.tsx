import { useFaceTimeStore } from "../state/facetime";

export function OutgoingCallModal() {
  const outgoing = useFaceTimeStore((s) => s.outgoingCall);
  const cancelCall = useFaceTimeStore((s) => s.cancelOutgoingCall);

  if (!outgoing) return null;

  const initial = (outgoing.receiver.displayName || outgoing.receiver.username || "?").charAt(0).toUpperCase();

  const getStatusText = () => {
    if (outgoing.status === "declined") return "Call Declined";
    if (outgoing.status === "missed") return "No Answer";
    return "Calling…";
  };

  return (
    <div className="facetime-call-overlay">
      <div className="facetime-incoming-card outgoing">
        <div className="facetime-avatar-container">
          {outgoing.status === "calling" && (
            <>
              <div className="facetime-avatar-ring pulse"></div>
              <div className="facetime-avatar-ring pulse delayed"></div>
            </>
          )}
          <div className="facetime-avatar">{initial}</div>
        </div>

        <div className="facetime-caller-info">
          <h2>{outgoing.receiver.displayName}</h2>
          <p className={`facetime-subtitle ${outgoing.status !== "calling" ? "error" : ""}`}>
            {getStatusText()}
          </p>
          <span className="facetime-username">@{outgoing.receiver.username}</span>
        </div>

        <div className="facetime-actions centered">
          <button
            type="button"
            className="facetime-btn facetime-btn-decline"
            onClick={cancelCall}
            aria-label="End Call"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1 0-1.41C2.69 9.37 6.94 8 12 8s9.31 1.37 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
}
