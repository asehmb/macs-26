# RealityCheck

RealityCheck turns a video call into visual guidance that stays attached to the object. The presenter films a printed target with a phone; the helper taps on the live video, and each pin, arrow, or label is stored in the target's own millimetre coordinates, so it stays on the same spot as the phone moves, tilts, or rotates.

## What works

- Two-person room: presenter (phone camera) and helper (any browser), WebRTC video + two-way audio, Socket.IO for signaling and shared state.
- ArUco tracking in the browser (js-aruco2, `ARUCO_MIP_36h12`): least-squares homography over all visible markers, outlier rejection, One Euro smoothing, 300 ms hold before "Target lost".
- Annotations: pin, arrow (tap start, tap end), text label; edit, delete, clear. Stored in target millimetres, rendered on both screens.
- Recovery: Reset tracking, Reconnect video, camera restart/flip, status chips for server, peer, video, and tracking.
- P1: ordered steps with per-step annotations and shared progress; colour-zone verification ("Aligned" / "Not yet" / "Tracking lost") with a manual Approve; laser pointer in target space.
- Bench: live tracking fps, detection time, lost-frame %, reference-marker error (px and mm), annotation sync latency, task timer, clarification counter, trial log with CSV export (`/bench`).

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # server on :3001, client on :5173
```

Open `http://localhost:5173`. To try everything on one laptop without a camera, open a presenter tab with `?synthetic=1` (it renders a moving virtual target), e.g. `http://localhost:5173/room/TEST?role=presenter&synthetic=1`, and a helper tab at `http://localhost:5173/room/TEST?role=helper`.

Other commands:

```bash
npm test             # tracking accuracy (rendered target, known poses) + server room/signaling checks
npm run typecheck
npm run build        # production client build
npm start            # serves client/dist and the socket server on $PORT (default 3001)
npm run target:generate   # regenerate client/public/target.pdf
```

## Testing with a phone

Phones only allow camera access on HTTPS, so use the ngrok tunnel.

1. Print `client/public/target.pdf` at **100% / Actual size** (not "Fit to page"). The 100 mm scale bar on the sheet should measure 100 mm.
2. `npm run dev` in one terminal, `npm run tunnel` in another (needs `ngrok config add-authtoken …` once).
3. On the laptop, open the `https://….ngrok-free.app` URL (not localhost, so the QR code points somewhere the phone can reach). Click through ngrok's warning page once.
4. Create a room, click **Join as helper**. The waiting screen shows a QR code.
5. Scan the QR code with the phone. It opens as presenter and asks for the camera; allow it. The rear camera is used by default.
6. Point the phone at the printed sheet. The chip should read **Target tracked**.
7. On the phone tap **Show debug**: yellow outlines should hug the markers and the red ring should sit on the printed crosshair dot. If the ring is off, the print was scaled.
8. On the laptop, tap a spot on the sheet to drop a pin. Move, tilt, and rotate the phone: the pin should stay on that spot on both screens. Cover one corner marker with your hand: tracking should continue.

If the video never connects ("Connecting video" stays), the two devices cannot reach each other directly (common on venue Wi-Fi and phone hotspots). Put both on the same home Wi-Fi, or set `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` in `.env` (see `.env.example`) and restart `npm run dev`.

On iPhone, if the helper's voice is silent, tap **Tap to turn on sound** (iOS blocks autoplay audio).

## Deploying (Render)

`render.yaml` defines one web service: `npm ci --include=dev && npm run build`, then `npm start`. Render sets `PORT`. TURN variables, if used, must be set before the build because Vite inlines them.

## Measuring

Open the **Bench** panel in a room. Pick Guided or Baseline (Baseline hides all annotations), press **Start task**, count clarifications, then **Save trial**. All trials are listed at `/bench` and export to CSV with the same columns as `data/raw-results.csv`. See `docs/benchmark-summary.md`. Only measured values go in the results.

## Project structure

- `client/`: Vite + React + TypeScript app (`src/tracking` detection and homography, `src/overlay` canvas rendering, `src/rtc` WebRTC, `src/state` zustand store and bench recorder).
- `server/`: Express + Socket.IO room state and signaling relay.
- `shared/`: event and state types, and the target layout (marker IDs, positions, zone) used by the PDF generator, tracker, and verification.
- `scripts/`: target PDF generator and test scripts.
- `docs/architecture.md`: data flow and coordinate pipeline.

## Known limitations

- Needs the printed target; it does not track arbitrary objects.
- Room state is in memory on one server; a restart clears rooms.
- Verification is a colour check inside a fixed printed zone, not object recognition.
- No TURN server is bundled; restrictive networks need one configured.
- The presenter's phone must stay in the foreground; browsers stop the camera in background tabs.

## Attribution

- [js-aruco2](https://github.com/damianofalcioni/js-aruco2) (marker detection, `ARUCO_MIP_36h12` dictionary), MIT.
- React, Vite, zustand, react-router, Socket.IO, Express, qrcode.react, PDFKit.
- One Euro filter: Casiez, Roussel, Vogel, CHI 2012.
