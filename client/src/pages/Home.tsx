import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthModal } from "../components/AuthModal";
import { useFaceTimeStore } from "../state/facetime";

export function Home() {
  const navigate = useNavigate();
  const user = useFaceTimeStore((s) => s.user);
  const loadingAuth = useFaceTimeStore((s) => s.loadingAuth);
  const logout = useFaceTimeStore((s) => s.logout);

  const friends = useFaceTimeStore((s) => s.friends);
  const requests = useFaceTimeStore((s) => s.requests);
  const history = useFaceTimeStore((s) => s.history);

  const startCall = useFaceTimeStore((s) => s.startCall);
  const sendFriendRequest = useFaceTimeStore((s) => s.sendFriendRequest);
  const respondFriendRequest = useFaceTimeStore((s) => s.respondFriendRequest);
  const removeFriend = useFaceTimeStore((s) => s.removeFriend);
  const navigationTarget = useFaceTimeStore((s) => s.navigationTarget);
  const clearNavigationTarget = useFaceTimeStore((s) => s.clearNavigationTarget);

  const [activeTab, setActiveTab] = useState<"friends" | "recents">("friends");
  const [addUsername, setAddUsername] = useState("");
  const [addFeedback, setAddFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (navigationTarget) {
      const target = navigationTarget;
      clearNavigationTarget();
      navigate(target);
    }
  }, [navigationTarget, clearNavigationTarget, navigate]);

  if (loadingAuth) {
    return (
      <div className="facetime-loading-screen">
        <div className="facetime-spinner"></div>
        <p>Loading FaceTime…</p>
      </div>
    );
  }

  if (!user) {
    return <AuthModal />;
  }

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = addUsername.trim();
    if (!target) return;
    setAdding(true);
    const res = await sendFriendRequest(target);
    setAdding(false);
    setAddFeedback({ text: res.message || (res.success ? "Request sent" : "Failed"), isError: !res.success });
    if (res.success) setAddUsername("");
    window.setTimeout(() => setAddFeedback(null), 4000);
  };

  const userInitial = (user.displayName || user.username).charAt(0).toUpperCase();

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="facetime-app">
      {/* FaceTime Sidebar */}
      <aside className="facetime-sidebar">
        {/* User profile row */}
        <header className="facetime-user-header">
          <div className="facetime-user-profile">
            <div className="facetime-user-avatar">
              {userInitial}
              <span className="facetime-online-dot"></span>
            </div>
            <div className="facetime-user-names">
              <span className="facetime-display-name">{user.displayName}</span>
              <span className="facetime-user-handle">@{user.username}</span>
            </div>
          </div>
          <button type="button" className="facetime-logout-btn" onClick={logout} title="Sign Out">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
          </button>
        </header>

        {/* Tab switcher: Friends vs Recents */}
        <nav className="facetime-tabs">
          <button
            type="button"
            className={activeTab === "friends" ? "active" : ""}
            onClick={() => setActiveTab("friends")}
          >
            <span>Friends</span>
            {requests.length > 0 && <span className="facetime-badge">{requests.length}</span>}
          </button>
          <button
            type="button"
            className={activeTab === "recents" ? "active" : ""}
            onClick={() => setActiveTab("recents")}
          >
            <span>Recents</span>
          </button>
        </nav>

        {/* Add Friend bar */}
        <form onSubmit={handleAddFriend} className="facetime-add-bar">
          <input
            type="text"
            placeholder="Add friend by username…"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            autoCapitalize="none"
          />
          <button type="submit" disabled={adding || !addUsername.trim()}>
            {adding ? "…" : "+"}
          </button>
        </form>

        {addFeedback && (
          <div className={`facetime-alert ${addFeedback.isError ? "error" : "success"}`}>
            {addFeedback.text}
          </div>
        )}

        {/* Friends View */}
        {activeTab === "friends" && (
          <div className="facetime-list-container">
            {/* Pending Requests Section */}
            {requests.length > 0 && (
              <section className="facetime-section">
                <h3 className="facetime-section-title">Friend Requests ({requests.length})</h3>
                <div className="facetime-list">
                  {requests.map((req) => (
                    <div key={req.id} className="facetime-request-item">
                      <div className="facetime-avatar small">
                        {req.fromDisplayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="facetime-item-info">
                        <span className="facetime-item-name">{req.fromDisplayName}</span>
                        <span className="facetime-item-sub">@{req.fromUsername}</span>
                      </div>
                      <div className="facetime-item-actions">
                        <button
                          type="button"
                          className="facetime-action-accept"
                          onClick={() => respondFriendRequest(req.id, true)}
                          title="Accept"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="facetime-action-decline"
                          onClick={() => respondFriendRequest(req.id, false)}
                          title="Decline"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Friends Section */}
            <section className="facetime-section">
              <h3 className="facetime-section-title">All Friends ({friends.length})</h3>
              {friends.length === 0 ? (
                <div className="facetime-empty-state">
                  <p>No friends added yet.</p>
                  <span>Type a username above and tap + to add friends!</span>
                </div>
              ) : (
                <div className="facetime-list">
                  {friends.map((friend) => {
                    const initial = friend.displayName.charAt(0).toUpperCase();
                    const statusClass = friend.status; // 'online' | 'in-call' | 'offline'
                    const statusLabel =
                      friend.status === "online"
                        ? "Available"
                        : friend.status === "in-call"
                          ? "In a Call"
                          : "Offline";

                    return (
                      <div key={friend.id} className="facetime-friend-item">
                        <div className="facetime-avatar-wrapper">
                          <div className="facetime-avatar small">{initial}</div>
                          <span className={`facetime-status-indicator ${statusClass}`}></span>
                        </div>

                        <div className="facetime-item-info">
                          <span className="facetime-item-name">{friend.displayName}</span>
                          <span className="facetime-item-sub">
                            <span className={`status-text ${statusClass}`}>{statusLabel}</span> • @{friend.username}
                          </span>
                        </div>

                        <div className="facetime-item-actions">
                          <button
                            type="button"
                            className="facetime-call-btn"
                            disabled={friend.status !== "online"}
                            onClick={() => startCall(friend.id, "presenter")}
                            title={friend.status === "online" ? "FaceTime Video Call" : `${friend.displayName} is ${statusLabel.toLowerCase()}`}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                            </svg>
                            <span>Call</span>
                          </button>

                          <button
                            type="button"
                            className="facetime-more-btn"
                            onClick={() => {
                              if (confirm(`Remove @${friend.username} from your friends?`)) {
                                removeFriend(friend.id);
                              }
                            }}
                            title="Remove Friend"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Recents View */}
        {activeTab === "recents" && (
          <div className="facetime-list-container">
            <section className="facetime-section">
              <h3 className="facetime-section-title">Recent Calls</h3>
              {history.length === 0 ? (
                <div className="facetime-empty-state">
                  <p>No call history yet.</p>
                </div>
              ) : (
                <div className="facetime-list">
                  {history.map((record) => {
                    const isCaller = record.callerId === user.id;
                    const partnerId = isCaller ? record.receiverId : record.callerId;
                    const partnerName = isCaller ? record.receiverDisplayName : record.callerDisplayName;
                    const partnerUsername = isCaller ? record.receiverUsername : record.callerUsername;
                    const initial = partnerName.charAt(0).toUpperCase();

                    const isMissed = record.status === "missed" || (record.status === "declined" && !isCaller);

                    return (
                      <div key={record.id} className="facetime-friend-item recent">
                        <div className="facetime-avatar small">{initial}</div>
                        <div className="facetime-item-info">
                          <span className={`facetime-item-name ${isMissed ? "missed" : ""}`}>
                            {partnerName}
                          </span>
                          <span className="facetime-item-sub">
                            {isCaller ? "Outgoing" : isMissed ? "Missed Call" : "Incoming"}
                            {record.durationSec ? ` • ${formatDuration(record.durationSec)}` : ""}
                            {` • @${partnerUsername} • ${formatDate(record.startedAt)}`}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="facetime-call-btn compact"
                          onClick={() => startCall(partnerId, "presenter")}
                          title={`Call back ${partnerName}`}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="white">
                            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </aside>

      {/* Main FaceTime Welcome / Active Area */}
      <main className="facetime-main-stage">
        <div className="facetime-welcome-card">
          <div className="facetime-hero-icon">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="white">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
          </div>
          <h1>FaceTime</h1>
          <p className="facetime-hero-tagline">
            Direct video calls with friends. Real-time AR guidance. No room codes needed.
          </p>

          <div className="facetime-features-grid">
            <div className="facetime-feature-box">
              <span className="feature-icon">👤</span>
              <h3>Add Friends</h3>
              <p>Search by username, connect instantly, and see when your friends are online.</p>
            </div>

            <div className="facetime-feature-box">
              <span className="feature-icon">📞</span>
              <h3>1-Click Calling</h3>
              <p>Calls trigger a real ringing notification with Pick Up and Decline options.</p>
            </div>

            <div className="facetime-feature-box">
              <span className="feature-icon">🎯</span>
              <h3>AR Object Guidance</h3>
              <p>Point at the printed target to drop pins, draw arrows, and guide each other in 3D space.</p>
            </div>
          </div>

          <div className="facetime-footer-links">
            <a href="/target.pdf" target="_blank" rel="noreferrer" className="facetime-link-btn">
              📄 Download & Print AR Target PDF
            </a>
            <Link to="/bench" className="facetime-link-btn ghost">
              📊 Benchmark Trials
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
