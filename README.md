# RealityCheck

RealityCheck is a browser video-calling app where the person helping you can point. You call a friend; one of you films with a phone ("Show"), the other guides from any browser ("Guide"). The guide taps the live video to drop pins, arrows and labels, and they stay attached to the real object as the phone moves — like Apple's Measure app, but over a call.

## What works

- **Direct calling:** accounts (username + password), friends and friend requests, online / in-a-call presence, ringing with accept / decline, call history. The caller picks their role (Show or Guide); the friend gets the other one.
- **Two-way call:** WebRTC video and audio between the two devices, with Socket.IO for signalling and shared room state. The guide can turn on their webcam, which shows picture-in-picture on the phone.
- **World tracking (default):** markerless tracking on the presenter's phone with the 8th Wall SLAM engine. A tap on the guide's screen becomes a tracked 3D point on the phone:
  - depth comes from nearby map points, or from a plane fitted to the surroundings on plain surfaces;
  - taps are resolved against the exact video frame the guide saw, using a frame number burned into the video;
  - pins follow map refinements and are snapped back into place by image-patch matching.
- **Printed-sheet mode (fallback and benchmark):** ArUco markers on a printed sheet, a least-squares homography, One Euro smoothing, and annotations stored in millimetres on the sheet. Works on laptops too.
- **Guidance tools:**
  - pin, arrow, text label, and laser pointer;
  - ordered steps with per-step annotations;
  - colour-zone verification (sheet mode only).
- **Bench (sheet mode):** tracking fps, detection time, lost frames, reference-marker error, annotation sync latency, task timer, clarification counter, CSV export at `/bench`.

## Quick start

Requires Node 22.13+ (the server uses the built-in `node:sqlite`).

```bash
npm install
npm run dev          # server on :3001, client on :5173
```

Open `http://localhost:5173`, create an account, and in a second browser (or a private window) create another. Add each other as friends, then call.

To test without accounts or a phone, open a room URL directly:

- **Printed-sheet mode on one laptop:** a presenter tab at `http://localhost:5173/room/TEST?role=presenter&synthetic=1` renders a moving virtual sheet; open a helper tab at `http://localhost:5173/room/TEST?role=helper`.
- **World mode on one laptop (dev only):** a presenter tab at `http://localhost:5173/room/TEST?role=presenter&fakeworld=1` swaps in a fake tracking engine that renders a textured wall; open the same helper tab.
- **World tracking test page:** `/world-spike` runs tracking alone, with a heads-up display (phone only).

Other commands:

```bash
npm test             # tracking, world math, patch matching, server relay, accounts/calling
npm run typecheck
npm run build        # production client build (also copies the 8th Wall engine to dist/external/xr/)
npm start            # serves client/dist and the socket server on $PORT (default 3001)
npm run target:generate   # regenerate client/public/target.pdf
```

## Testing with a phone

Phones only allow camera access on HTTPS, so use the ngrok tunnel.

1. `npm run dev` in one terminal, `npm run tunnel` in another (needs `ngrok config add-authtoken …` once).
2. Open the `https://….ngrok-free.app` URL on both the laptop and the phone. Click through ngrok's warning page once on each.
3. Sign in on both (two different accounts) and add each other as friends.
4. On the laptop, set **When I call, I'll** to **Guide** and call the phone's account. Accept on the phone.
5. On the phone, tap **Start camera**, allow motion, camera and microphone, then move the phone slowly around the object for a few seconds so it can map the scene.
6. On the laptop, tap the object to drop a pin. Walk around, look away and back: the pin should stay on the object.

Tips:

- Good light and textured surfaces track best; plain white surfaces work but give the engine fewer points.
- **Show debug** on either side uploads diagnostics to the laptop in development (`.debug/presenter.json`, `.debug/helper.json` and frame snapshots).
- If the video never connects ("Connecting video" stays), the devices can't reach each other directly (common on venue Wi-Fi and hotspots). Use the same home Wi-Fi, or set `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` in `.env` (see `.env.example`) and restart `npm run dev`.
- On iPhone, if the other side's voice is silent, tap **Tap to turn on sound** (iOS blocks autoplay audio).

### Printed-sheet mode

Print `client/public/target.pdf` at **100% / Actual size**; the 100 mm scale bar should measure 100 mm. In a room, tap **Use the printed sheet instead** (before starting the camera) or **Use printed sheet** (in the room controls) on the phone, then point the phone at the sheet until the chip reads **Target tracked**.

## Deploying (Render)

`render.yaml` defines one web service: `npm ci --include=dev && npm run build`, then `npm start`. Render sets `PORT`. TURN variables, if used, must be set before the build because Vite inlines them. The SQLite database lives in `data/` on the server's disk; on Render's free plan that disk is not persistent, so accounts reset on redeploy.

## Measuring

Benchmarks run in printed-sheet mode. Open the **Bench** panel in a room, pick Guided or Baseline (Baseline hides all annotations), press **Start task**, count clarifications, then **Save trial**. All trials are listed at `/bench` and export to CSV with the same columns as `data/raw-results.csv`. See `docs/benchmark-summary.md`. Only measured values go in the results.

## Project structure

- `client/`: Vite + React + TypeScript app.
  - `src/world/`: world tracking (engine session, depth picking, point anchoring, patch matching, frame tags, fake engine).
  - `src/tracking/`: printed-sheet tracking (marker detection, homography, smoothing, coordinates, verification).
  - `src/rtc/`: WebRTC links.
  - `src/state/`: zustand stores for the room (`room.ts`) and accounts and calls (`facetime.ts`), plus the bench recorder.
  - `src/overlay/`: canvas drawing.
  - `src/pages/`: Home, Room, Bench.
- `server/`: Express + Socket.IO. `index.ts` serves the REST API, call signalling, rooms, and relays; `db.ts` holds users, sessions, friends, and call history in SQLite.
- `shared/`: event and state types used by both client and server, and the printed-sheet layout.
- `scripts/`: target PDF generator and test suites.
- `docs/architecture.md`: components, data flow, events.
- `docs/code-guide.md`: key methods and the end-to-end flow of a call, a tap, and a pin.

## Known limitations

- World tracking runs only on phones; laptops can guide, or present in printed-sheet mode.
- A thin object with few map points in front of a well-mapped surface can be mistaken for that surface when tapped.
- Room state is in memory on one server; a restart clears rooms (accounts and history persist in SQLite).
- Verification is a colour check inside a fixed printed zone, not object recognition.
- No TURN server is bundled; restrictive networks need one configured.
- The presenter's phone must stay in the foreground; browsers stop the camera in background tabs.

## Attribution

- [8th Wall engine](https://github.com/8thwall/engine/blob/main/LICENSE) by Niantic Spatial (markerless SLAM); attribution is shown on the presenter's screen.
- [js-aruco2](https://github.com/damianofalcioni/js-aruco2) (marker detection, `ARUCO_MIP_36h12` dictionary), MIT.
- React, Vite, zustand, react-router, Socket.IO, Express, qrcode.react, PDFKit.
- One Euro filter: Casiez, Roussel, Vogel, CHI 2012.
