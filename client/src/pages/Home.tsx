import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function Home() {
  const [code, setCode] = useState(randomCode);
  const navigate = useNavigate();
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const presenterLink = `${window.location.origin}/room/${cleanCode}?role=presenter`;
  const isLocalhost = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const insecure = !window.isSecureContext;

  return (
    <main className="page">
      <h1>RealityCheck</h1>
      <p className="subtitle">Video calls show you what someone sees. RealityCheck lets you guide what they do.</p>

      {insecure && (
        <p className="warn">
          This page is not on HTTPS, so the camera will not work here. Open the https:// link instead.
        </p>
      )}

      <section className="card">
        <label htmlFor="roomCode">Room code</label>
        <div className="row">
          <input
            id="roomCode"
            value={code}
            maxLength={12}
            autoCapitalize="characters"
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="button" className="ghost" onClick={() => setCode(randomCode())}>
            New code
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="big"
            disabled={!cleanCode}
            onClick={() => navigate(`/room/${cleanCode}?role=presenter`)}
          >
            Join as presenter (camera)
          </button>
          <button
            type="button"
            className="big"
            disabled={!cleanCode}
            onClick={() => navigate(`/room/${cleanCode}?role=helper`)}
          >
            Join as helper (guide)
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Phone joins as presenter</h2>
        <p className="muted">Scan with the phone that will film the object.</p>
        <QRCodeSVG value={presenterLink} size={180} includeMargin className="qr" />
        <code className="wrap">{presenterLink}</code>
        {isLocalhost && (
          <p className="warn">This is a localhost link, so phones can't open it. Open this page through the https ngrok URL first.</p>
        )}
      </section>

      <section className="card">
        <h2>Before the demo</h2>
        <ol>
          <li>
            Rooms use world tracking on the presenter's phone: no printed sheet needed. Tap Start, then move the phone
            slowly around the object for a few seconds. Good light and textured surfaces help.
          </li>
          <li>
            For the printed-sheet fallback (and the benchmark), print the{" "}
            <a href="/target.pdf" target="_blank" rel="noreferrer">tracking target</a> at 100% / actual size, check that
            the scale bar measures 100 mm, and tap <strong>Use printed sheet</strong> on the presenter.
          </li>
        </ol>
        <Link to="/bench">Benchmark trials</Link>
        {" · "}
        <Link to="/world-spike">World tracking test (no printed sheet)</Link>
      </section>
    </main>
  );
}
