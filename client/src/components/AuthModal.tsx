import { useState } from "react";
import { useFaceTimeStore } from "../state/facetime";

export function AuthModal() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const login = useFaceTimeStore((s) => s.login);
  const register = useFaceTimeStore((s) => s.register);
  const authError = useFaceTimeStore((s) => s.authError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    if (isRegister) {
      await register(username.trim(), password.trim(), displayName.trim() || undefined);
    } else {
      await login(username.trim(), password.trim());
    }
    setLoading(false);
  };

  return (
    <div className="facetime-auth-container">
      <div className="facetime-auth-card">
        <div className="facetime-logo-badge">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        </div>

        <h1>FaceTime</h1>
        <p className="facetime-auth-desc">Sign in with your username to connect with friends</p>

        <div className="facetime-segmented-control">
          <button
            type="button"
            className={!isRegister ? "active" : ""}
            onClick={() => setIsRegister(false)}
          >
            Sign In
          </button>
          <button
            type="button"
            className={isRegister ? "active" : ""}
            onClick={() => setIsRegister(true)}
          >
            Create Account
          </button>
        </div>

        {authError && <div className="facetime-auth-error">{authError}</div>}

        <form onSubmit={handleSubmit} className="facetime-form">
          <div className="form-group">
            <label htmlFor="authUsername">Username</label>
            <input
              id="authUsername"
              type="text"
              placeholder="e.g. alex"
              value={username}
              minLength={3}
              autoCapitalize="none"
              autoCorrect="off"
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="authDisplayName">Display Name (optional)</label>
              <input
                id="authDisplayName"
                type="text"
                placeholder="e.g. Alex Rivera"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="authPassword">Password {isRegister && <span style={{ color: "#8e8e93", fontSize: "0.75rem" }}>(min 4 chars)</span>}</label>
            <input
              id="authPassword"
              type="password"
              placeholder="••••••••"
              value={password}
              minLength={4}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="facetime-submit-btn" disabled={loading}>
            {loading ? "Please wait…" : isRegister ? "Create Account" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
