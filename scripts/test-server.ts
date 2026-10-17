import { spawn } from "node:child_process";
import { io, type Socket } from "socket.io-client";
import type { PeerInfo, RoomState } from "../shared/src/types.ts";

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function next<T>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true, timeoutMs = 2000) {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(value);
    };
    socket.on(event, handler);
  });
}

async function connect(): Promise<Socket> {
  const socket = io(URL, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

const server = spawn("npx", ["tsx", "server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});

await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 15000);
  server.stdout.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("listening")) {
      clearTimeout(timer);
      resolve();
    }
  });
});

try {
  const presenter = await connect();
  const presenterPeers = next<PeerInfo[]>(presenter, "room:peers", (p) => p.length === 2);
  const presenterState = next<RoomState>(presenter, "state:sync");
  presenter.emit("room:join", { code: "test1", role: "presenter" });
  const initial = await presenterState;
  check("join returns room state", initial?.code === "TEST1" && initial.mode === "guided");

  const helper = await connect();
  const helperPeers = next<PeerInfo[]>(helper, "room:peers", (p) => p.length === 2);
  helper.emit("room:join", { code: "TEST1", role: "helper" });
  const [pp, hp] = await Promise.all([presenterPeers, helperPeers]);
  check(
    "both sides see presenter + helper",
    Boolean(pp && hp && pp.some((p) => p.role === "helper" && p.id === helper.id) && hp.some((p) => p.role === "presenter")),
  );

  const signal = next<{ from: string; data: { kind: string } }>(presenter, "signal");
  helper.emit("signal", { to: presenter.id, data: { kind: "request-offer" } });
  const received = await signal;
  check("signal is routed to target with sender id", received?.from === helper.id && received?.data.kind === "request-offer");

  const outsider = await connect();
  outsider.emit("room:join", { code: "OTHER", role: "helper" });
  await next(outsider, "state:sync");
  const leaked = next(presenter, "signal", () => true, 500);
  outsider.emit("signal", { to: presenter.id, data: { kind: "request-offer" } });
  check("signals across rooms are dropped", (await leaked) === null);

  const synced = next<RoomState>(presenter, "state:sync", (s) => s.annotations.length === 1);
  helper.emit("ann:add", {
    id: "a1",
    type: "pin",
    creatorId: helper.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    start: { x: 95, y: 130 },
  });
  const afterAdd = await synced;
  check("annotation syncs in target mm", afterAdd?.annotations[0]?.start.x === 95);

  const stepsSynced = next<RoomState>(presenter, "state:sync", (s) => s.currentStepId === "s2");
  helper.emit("steps:set", {
    steps: [
      { id: "s1", title: "One", completed: false },
      { id: "s2", title: "Two", completed: false },
    ],
  });
  helper.emit("steps:go", { stepId: "s2" });
  check("steps set and navigate", Boolean(await stepsSynced));

  const completed = next<RoomState>(presenter, "state:sync", (s) => s.steps[1]?.completed === true);
  helper.emit("steps:complete", { stepId: "s2", completed: true });
  check("step completion syncs", Boolean(await completed));

  const pose = next<{ homography: number[] | null }>(helper, "pose:fallback");
  const echo = next(presenter, "pose:fallback", () => true, 500);
  presenter.emit("pose:fallback", { homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], ts: Date.now() });
  check("pose relays to helper", Array.isArray((await pose)?.homography));
  check("pose is not echoed to sender", (await echo) === null);

  const serverTime = await new Promise<number>((resolve) => presenter.emit("clock:ping", resolve));
  check("clock ping acks server time", Math.abs(serverTime - Date.now()) < 1000);

  const leftPeers = next<PeerInfo[]>(presenter, "room:peers", (p) => p.length === 1);
  helper.disconnect();
  check("peer list updates on disconnect", Boolean(await leftPeers));

  const rejoin = await connect();
  const restored = next<RoomState>(rejoin, "state:sync");
  rejoin.emit("room:join", { code: "TEST1", role: "helper" });
  check("state survives reconnect", (await restored)?.annotations.length === 1);

  presenter.disconnect();
  outsider.disconnect();
  rejoin.disconnect();
} finally {
  server.kill();
}

if (failures) {
  console.error(`${failures} server check(s) failed`);
  process.exit(1);
}
console.log("All server checks passed");
process.exit(0);
