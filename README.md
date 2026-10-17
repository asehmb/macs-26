# RealityCheck

RealityCheck turns a normal video call into interactive visual guidance. A presenter points a phone camera at a physical target while a helper anchors instructions directly onto that target.

## What works now

- Two-user browser sessions using WebRTC media + Socket.IO signaling/state.
- Mobile presenter flow with rear-camera default, front/rear switch, and permission/error states.
- Shared anchored annotations (`pin`, `arrow`, `text`) synchronized in room state.
- ArUco-based target tracking with target-relative coordinates and live reprojection overlays.
- Recovery controls: reset tracking, clear annotations, reconnect peer.
- P1 additions:
  - ordered checklist steps with progress;
  - live laser pointer;
  - simple color-zone verification status (`aligned`, `not_yet`, `tracking_lost`).
- Bench tooling for timing/clarification tracking plus CSV export.

## Project structure

- `client/`: Vite + React + TypeScript app.
- `server/`: Express + Socket.IO room/signaling server.
- `shared/`: shared TypeScript contracts for room events/state.
- `scripts/make-target.ts`: generates printable `client/public/target.pdf`.
- `docs/architecture.md`: pipeline diagram and data flow.
- `docs/benchmark-summary.md`: methodology + raw-results template.

## Quick start

Prereqs:

- Node.js 20+ (tested on Node 26)
- npm
- ngrok (optional for phone testing during local dev)

Install dependencies:

```bash
npm install
npm --prefix client install
```

Generate target board:

```bash
npm run target:generate
```

Run dev server + client:

```bash
npm run dev
```

Open:

- Web app: `http://localhost:5173`
- Server health: `http://localhost:3001/healthz`

Phone testing over HTTPS tunnel:

```bash
npm run tunnel
```

Use the `https://<ngrok>.ngrok-free.app` URL on the phone browser.

## Environment variables

Copy `.env.example` to `.env` and set TURN values when needed:

- `VITE_TURN_URL`
- `VITE_TURN_USER`
- `VITE_TURN_PASS`
- `PORT` (optional server port)

## Production build

```bash
npm run build
```

Then run server in production mode:

```bash
npm run start
```

## Demo checklist

1. Print `client/public/target.pdf` at 100% scale.
2. Start app and join one room from two devices.
3. Presenter selects rear camera and points at target.
4. Helper places annotation on target.
5. Move/tilt target and show annotation remains attached.
6. Show reset/recovery controls.
7. Show bench numbers from real trials only.

## Known limitations

- Tracking currently loads `js-aruco2` scripts at runtime from `unpkg.com`.
- In-memory room state (no persistence/database).
- Verification is a constrained color-region check, not general object understanding.
- Final iOS/Android field testing and trial numbers must be captured on real devices.

## Attribution

- React + Vite
- Socket.IO
- js-aruco2
- aruco-marker
- QRCode React
