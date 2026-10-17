import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import type {
  Annotation,
  JoinPayload,
  PointerState,
  PoseFallback,
  RoomState,
  Step,
} from "../../shared/src/types.ts";

type SignalPayload = {
  to: string;
  data: unknown;
};

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_DIST = path.resolve(process.cwd(), "client", "dist");
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());

const rooms = new Map<string, RoomState>();

function createRoomState(code: string): RoomState {
  const defaultSteps: Step[] = [
    { id: "step-1", title: "Step 1", completed: false },
    { id: "step-2", title: "Step 2", completed: false },
  ];

  return {
    code,
    annotations: [],
    steps: defaultSteps,
    currentStepId: defaultSteps[0]?.id ?? null,
    pointer: { position: null, ts: Date.now() },
    poseFallback: { homography: null, ts: Date.now(), status: "lost" },
  };
}

function getRoomState(code: string): RoomState {
  const normalized = code.trim().toUpperCase();
  const existing = rooms.get(normalized);
  if (existing) {
    return existing;
  }
  const created = createRoomState(normalized);
  rooms.set(normalized, created);
  return created;
}

function emitState(code: string) {
  const state = rooms.get(code);
  if (!state) {
    return;
  }
  io.to(code).emit("state:sync", state);
}

io.on("connection", (socket) => {
  socket.on("room:join", ({ code }: JoinPayload) => {
    const normalized = code.trim().toUpperCase();
    const state = getRoomState(normalized);
    socket.join(normalized);
    socket.emit("state:sync", state);
    io.to(normalized).emit("room:presence", {
      members: io.sockets.adapter.rooms.get(normalized)?.size ?? 0,
    });
  });

  socket.on("signal", ({ to, data }: SignalPayload) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("ann:add", (payload: Annotation & { code: string }) => {
    const state = getRoomState(payload.code);
    state.annotations.push(payload);
    emitState(state.code);
  });

  socket.on("ann:update", (payload: Annotation & { code: string }) => {
    const state = getRoomState(payload.code);
    state.annotations = state.annotations.map((annotation) =>
      annotation.id === payload.id ? payload : annotation,
    );
    emitState(state.code);
  });

  socket.on("ann:delete", ({ code, id }: { code: string; id: string }) => {
    const state = getRoomState(code);
    state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
    emitState(state.code);
  });

  socket.on("ann:clear", ({ code }: { code: string }) => {
    const state = getRoomState(code);
    state.annotations = [];
    emitState(state.code);
  });

  socket.on("steps:set", ({ code, steps }: { code: string; steps: Step[] }) => {
    const state = getRoomState(code);
    state.steps = steps;
    if (!steps.find((step) => step.id === state.currentStepId)) {
      state.currentStepId = steps[0]?.id ?? null;
    }
    emitState(state.code);
  });

  socket.on("steps:advance", ({ code }: { code: string }) => {
    const state = getRoomState(code);
    const idx = state.steps.findIndex((step) => step.id === state.currentStepId);
    if (idx >= 0 && idx + 1 < state.steps.length) {
      state.currentStepId = state.steps[idx + 1].id;
    }
    emitState(state.code);
  });

  socket.on("steps:complete", ({ code, stepId }: { code: string; stepId: string }) => {
    const state = getRoomState(code);
    state.steps = state.steps.map((step) =>
      step.id === stepId ? { ...step, completed: !step.completed } : step,
    );
    emitState(state.code);
  });

  socket.on("pointer:move", ({ code, pointer }: { code: string; pointer: PointerState }) => {
    const state = getRoomState(code);
    state.pointer = pointer;
    socket.to(state.code).emit("pointer:move", pointer);
  });

  socket.on(
    "pose:fallback",
    ({ code, pose }: { code: string; pose: PoseFallback }) => {
      const state = getRoomState(code);
      state.poseFallback = pose;
      socket.to(state.code).emit("pose:fallback", pose);
    },
  );

  socket.on("bench:ping", ({ sentAt }: { sentAt: number }) => {
    socket.emit("bench:pong", { sentAt, serverTime: Date.now() });
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, at: Date.now() });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RealityCheck server listening on :${PORT}`);
});
