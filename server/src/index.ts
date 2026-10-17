import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import type {
  Annotation,
  ColorPreset,
  GuidanceMode,
  JoinPayload,
  PeerInfo,
  PointerState,
  PoseFallback,
  Role,
  RoomState,
  SignalMessage,
  Step,
  VerifyReport,
} from "../../shared/src/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_DIST = path.resolve(process.cwd(), "client", "dist");
const EMPTY_ROOM_TTL_MS = 2 * 60 * 60 * 1000;

type Room = {
  state: RoomState;
  members: Map<string, Role>;
  cleanupTimer: NodeJS.Timeout | null;
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const rooms = new Map<string, Room>();

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function getRoom(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = {
      state: {
        code,
        annotations: [],
        steps: [],
        currentStepId: null,
        mode: "guided",
        verifyColor: "blue",
      },
      members: new Map(),
      cleanupTimer: null,
    };
    rooms.set(code, room);
  }
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  return room;
}

function peersOf(room: Room): PeerInfo[] {
  return [...room.members.entries()].map(([id, role]) => ({ id, role }));
}

function broadcastState(room: Room) {
  io.to(room.state.code).emit("state:sync", room.state);
}

function broadcastPeers(room: Room) {
  io.to(room.state.code).emit("room:peers", peersOf(room));
}

function leave(socket: Socket) {
  const code: string | undefined = socket.data.code;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.code = undefined;
  if (!room) return;
  room.members.delete(socket.id);
  broadcastPeers(room);
  if (room.members.size === 0) {
    room.cleanupTimer = setTimeout(() => rooms.delete(code), EMPTY_ROOM_TTL_MS);
  }
}

io.on("connection", (socket) => {
  const currentRoom = () => {
    const code: string | undefined = socket.data.code;
    return code ? rooms.get(code) : undefined;
  };

  const mutate = (fn: (state: RoomState) => void) => {
    const room = currentRoom();
    if (!room) return;
    fn(room.state);
    broadcastState(room);
  };

  socket.on("room:join", ({ code, role }: JoinPayload) => {
    const normalized = normalizeCode(code);
    if (!normalized || (role !== "presenter" && role !== "helper")) return;
    leave(socket);
    const room = getRoom(normalized);
    room.members.set(socket.id, role);
    socket.data.code = normalized;
    socket.join(normalized);
    socket.emit("state:sync", room.state);
    broadcastPeers(room);
  });

  socket.on("room:leave", () => leave(socket));
  socket.on("disconnect", () => leave(socket));

  socket.on("signal", ({ to, data }: { to: string; data: SignalMessage }) => {
    const room = currentRoom();
    if (!room || !room.members.has(to)) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("ann:add", (annotation: Annotation) =>
    mutate((state) => {
      state.annotations.push(annotation);
    }),
  );

  socket.on("ann:update", (annotation: Annotation) =>
    mutate((state) => {
      state.annotations = state.annotations.map((item) => (item.id === annotation.id ? annotation : item));
    }),
  );

  socket.on("ann:delete", ({ id }: { id: string }) =>
    mutate((state) => {
      state.annotations = state.annotations.filter((item) => item.id !== id);
    }),
  );

  socket.on("ann:clear", () =>
    mutate((state) => {
      state.annotations = [];
    }),
  );

  socket.on("steps:set", ({ steps }: { steps: Step[] }) =>
    mutate((state) => {
      state.steps = steps;
      if (!steps.some((step) => step.id === state.currentStepId)) {
        state.currentStepId = steps[0]?.id ?? null;
      }
    }),
  );

  socket.on("steps:go", ({ stepId }: { stepId: string }) =>
    mutate((state) => {
      if (state.steps.some((step) => step.id === stepId)) state.currentStepId = stepId;
    }),
  );

  socket.on("steps:complete", ({ stepId, completed }: { stepId: string; completed: boolean }) =>
    mutate((state) => {
      state.steps = state.steps.map((step) => (step.id === stepId ? { ...step, completed } : step));
    }),
  );

  socket.on("mode:set", ({ mode }: { mode: GuidanceMode }) =>
    mutate((state) => {
      state.mode = mode === "baseline" ? "baseline" : "guided";
    }),
  );

  socket.on("verify:color", ({ color }: { color: ColorPreset }) =>
    mutate((state) => {
      state.verifyColor = color;
    }),
  );

  socket.on("verify:report", (report: VerifyReport) => {
    const room = currentRoom();
    if (room) socket.volatile.to(room.state.code).emit("verify:report", report);
  });

  socket.on("pointer:move", (pointer: PointerState) => {
    const room = currentRoom();
    if (room) socket.volatile.to(room.state.code).emit("pointer:move", pointer);
  });

  socket.on("pose:fallback", (pose: PoseFallback) => {
    const room = currentRoom();
    if (room) socket.volatile.to(room.state.code).emit("pose:fallback", pose);
  });

  socket.on("clock:ping", (ack: (serverTime: number) => void) => {
    if (typeof ack === "function") ack(Date.now());
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, at: Date.now() });
});

if (process.env.NODE_ENV !== "production") {
  const debugDir = path.resolve(process.cwd(), ".debug");
  app.post("/debug/report", express.json({ limit: "8mb" }), async (req, res) => {
    const { image, ...report } = req.body as { image?: string | null; role?: string };
    const role = report.role === "presenter" ? "presenter" : "helper";
    await mkdir(debugDir, { recursive: true });
    await writeFile(path.join(debugDir, `${role}.json`), JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
    if (image?.startsWith("data:image/jpeg;base64,")) {
      await writeFile(path.join(debugDir, `${role}.jpg`), Buffer.from(image.split(",")[1], "base64"));
    }
    res.sendStatus(204);
  });
}

if (process.env.NODE_ENV === "production") {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`RealityCheck server listening on :${PORT}`);
});
