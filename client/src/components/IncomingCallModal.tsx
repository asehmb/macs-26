import { useFaceTimeStore } from "../state/facetime";

export function IncomingCallModal() {
  const incoming = useFaceTimeStore((s) => s.incomingCall);
  const acceptCall = useFaceTimeStore((s) => s.acceptIncomingCall);
  const declineCall = useFaceTimeStore((s) => s.declineIncomingCall);

  if (!incoming) return null;

  const initial = (incoming.caller.displayName || incoming.caller.username || "?").charAt(0).toUpperCase();

  return (
    <div className="facetime-call-overlay">
      <div className="facetime-incoming-card">
        <div className="facetime-avatar-container">
          <div className="facetime-avatar-ring pulse"></div>
          <div className="facetime-avatar-ring pulse delayed"></div>
          <div className="facetime-avatar">{initial}</div>
        </div>

        <div className="facetime-caller-info">
          <h2>{incoming.caller.displayName}</h2>
          <p className="facetime-subtitle">RealityCheck video call…</p>
          <span className="facetime-username">@{incoming.caller.username}</span>
        </div>

        <div className="facetime-actions">
          <button
            type="button"
            className="facetime-btn facetime-btn-decline"
            onClick={declineCall}
            aria-label="Decline Call"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1 0-1.41C2.69 9.37 6.94 8 12 8s9.31 1.37 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
            <span>Decline</span>
          </button>

          <button
            type="button"
            className="facetime-btn facetime-btn-accept"
            onClick={acceptCall}
            aria-label="Accept Call"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-2.2 2.2a15.047 15.047 0 0 1-6.59-6.59l2.2-2.21a.96.96 0 0 0 .25-1.01A11.36 11.36 0 0 1 8.57 3.9c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.52c0-.55-.45-1-.99-1z"/>
            </svg>
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}
