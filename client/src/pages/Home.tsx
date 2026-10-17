import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function Home() {
  const [code, setCode] = useState(randomCode());
  const [role, setRole] = useState<"presenter" | "helper">("presenter");
  const navigate = useNavigate();
  const joinLink = useMemo(
    () => `${window.location.origin}/room/${code}?role=helper`,
    [code],
  );

  return (
    <main className="page">
      <h1>RealityCheck</h1>
      <p className="subtitle">Guide physical work with object-anchored instructions.</p>
      <div className="card">
        <label htmlFor="roomCode">Room code</label>
        <input
          id="roomCode"
          value={code}
          maxLength={8}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <label htmlFor="role">Role</label>
        <select
          id="role"
          value={role}
          onChange={(event) => setRole(event.target.value as "presenter" | "helper")}
        >
          <option value="presenter">Presenter (camera phone)</option>
          <option value="helper">Helper (annotator)</option>
        </select>
        <button type="button" onClick={() => navigate(`/room/${code}?role=${role}`)}>
          Join room
        </button>
      </div>
      <div className="card">
        <p>Share this helper link:</p>
        <code>{joinLink}</code>
        <QRCodeSVG value={joinLink} size={140} />
      </div>
      <div className="links">
        <Link to="/bench">Open bench tools</Link>
      </div>
    </main>
  );
}
