import express, { type Request, type Response, type NextFunction } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import type {
  Annotation,
  CallRecord,
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
  TrackingMode,
  User,
  VerifyReport,
  WorldResolveRequest,
  WorldResolveResult,
  WorldStatus,
} from "../../shared/src/types.ts";
import {
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  getCallHistory,
  getFriends,
  getPendingFriendRequests,
  getSessionUser,
  getUserById,
  getUserByUsername,
  recordCallStart,
  recordCallStatus,
  removeFriend,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
  updateLastSeen,
} from "./db.ts";

const WORLD_RESOLVE_TIMEOUT_MS = 3000;

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_DIST = path.resolve(process.cwd(), "client", "dist");
const EMPTY_ROOM_TTL_MS = 2 * 60 * 60 * 1000;

type Room = {
  state: RoomState;
  members: Map<string, Role>;
  cleanupTimer: NodeJS.Timeout | null;
};

const app = express();
app.use("/api", express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const rooms = new Map<string, Room>();

// User presence & call tracking
const userSockets = new Map<string, Set<string>>(); // userId -> Set of socketIds
const socketUsers = new Map<string, string>(); // socketId -> userId
const activeUserCalls = new Map<string, string>(); // userId -> callId
const activeCalls = new Map<
  string,
  {
    id: string;
    callerId: string;
    receiverId: string;
    status: "ringing" | "connected";
    startedAt: number;
    timer?: NodeJS.Timeout;
  }
>();

// Auth middleware for express
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  (req as unknown as { user: User; sessionToken: string }).user = user;
  (req as unknown as { user: User; sessionToken: string }).sessionToken = token;
  next();
}

function getUserStatus(userId: string): "online" | "in-call" | "offline" {
  if (activeUserCalls.has(userId)) return "in-call";
  if ((userSockets.get(userId)?.size ?? 0) > 0) return "online";
  return "offline";
}

function broadcastUserStatusToFriends(userId: string) {
  const status = getUserStatus(userId);
  const friends = getFriends(userId);
  for (const friend of friends) {
    const sockets = userSockets.get(friend.id);
    if (sockets) {
      for (const sockId of sockets) {
        io.to(sockId).emit("friend:status", { userId, status });
      }
    }
  }
}

// REST Endpoints
app.post("/api/auth/register", (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const user = createUser(username, password, displayName);
    const token = createSession(user.id);
    res.json({ user, token });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const user = authenticateUser(username, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const token = createSession(user.id);
    res.json({ user, token });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const reqUser = (req as unknown as { user: User }).user;
  res.json({ user: reqUser });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const sessionToken = (req as unknown as { sessionToken: string }).sessionToken;
  deleteSession(sessionToken);
  res.json({ ok: true });
});

app.get("/api/users/search", authMiddleware, (req, res) => {
  const q = String(req.query.q ?? "");
  const currentUserId = (req as unknown as { user: User }).user.id;
  const users = searchUsers(q, currentUserId);
  res.json({ users });
});

app.get("/api/friends", authMiddleware, (req, res) => {
  const userId = (req as unknown as { user: User }).user.id;
  const friendsList = getFriends(userId);
  const friends = friendsList.map((f) => ({
    ...f,
    status: getUserStatus(f.id),
  }));
  res.json({ friends });
});

app.post("/api/friends/request", authMiddleware, (req, res) => {
  try {
    const userId = (req as unknown as { user: User }).user.id;
    const { toUsername } = req.body;
    if (!toUsername) {
      return res.status(400).json({ error: "Target username is required" });
    }
    const result = sendFriendRequest(userId, toUsername);
    // If auto-accepted or request created, notify receiver if online
    const receiverSockets = userSockets.get(result.request.toUserId);
    if (receiverSockets) {
      for (const sockId of receiverSockets) {
        io.to(sockId).emit("friend:request_received", result.request);
      }
    }
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to send request" });
  }
});

app.get("/api/friends/requests", authMiddleware, (req, res) => {
  const userId = (req as unknown as { user: User }).user.id;
  const requests = getPendingFriendRequests(userId);
  res.json({ requests });
});

app.post("/api/friends/respond", authMiddleware, (req, res) => {
  try {
    const userId = (req as unknown as { user: User }).user.id;
    const { requestId, accept } = req.body;
    if (!requestId || typeof accept !== "boolean") {
      return res.status(400).json({ error: "requestId and accept boolean required" });
    }
    const result = respondToFriendRequest(requestId, userId, accept);
    if (accept) {
      // Notify sender that their request was accepted
      const senderSockets = userSockets.get(result.fromUserId);
      if (senderSockets) {
        for (const sockId of senderSockets) {
          io.to(sockId).emit("friend:request_accepted", { byUserId: userId });
        }
      }
      broadcastUserStatusToFriends(userId);
      broadcastUserStatusToFriends(result.fromUserId);
    }
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to respond to request" });
  }
});

app.delete("/api/friends/:friendId", authMiddleware, (req, res) => {
  const userId = (req as unknown as { user: User }).user.id;
  const friendId = String(req.params.friendId);
  removeFriend(userId, friendId);
  res.json({ ok: true });
});

app.get("/api/calls/history", authMiddleware, (req, res) => {
  const userId = (req as unknown as { user: User }).user.id;
  const history = getCallHistory(userId);
  res.json({ history });
});

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
        tracking: "world",
        helperCamera: false,
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
  const role = room.members.get(socket.id);
  room.members.delete(socket.id);
  broadcastPeers(room);
  if (role === "helper" && room.state.helperCamera && ![...room.members.values()].includes("helper")) {
    room.state.helperCamera = false;
    broadcastState(room);
  }
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

  // Socket authentication and presence tracking
  socket.on("auth:init", ({ token }: { token: string }) => {
    const user = getSessionUser(token);
    if (!user) return;
    socket.data.userId = user.id;
    socketUsers.set(socket.id, user.id);

    let set = userSockets.get(user.id);
    if (!set) {
      set = new Set();
      userSockets.set(user.id, set);
    }
    const wasOffline = set.size === 0;
    set.add(socket.id);

    if (wasOffline) {
      updateLastSeen(user.id);
      broadcastUserStatusToFriends(user.id);
    }
  });

  // Direct FaceTime calling handlers
  socket.on("call:start", ({ receiverId, role = "presenter" }: { receiverId: string; role?: Role }) => {
    const callerId: string | undefined = socket.data.userId;
    if (!callerId) {
      socket.emit("call:failed", { error: "Please log in to make calls" });
      return;
    }
    if (callerId === receiverId) {
      socket.emit("call:failed", { error: "Cannot call yourself" });
      return;
    }

    const caller = getUserById(callerId);
    const receiver = getUserById(receiverId);
    if (!caller || !receiver) {
      socket.emit("call:failed", { error: "User not found" });
      return;
    }

    const receiverSocketSet = userSockets.get(receiverId);
    if (!receiverSocketSet || receiverSocketSet.size === 0) {
      socket.emit("call:failed", { error: `${receiver.displayName} is offline` });
      const callId = recordCallStart(callerId, receiverId);
      recordCallStatus(callId, "missed");
      return;
    }

    if (activeUserCalls.has(receiverId)) {
      socket.emit("call:failed", { error: `${receiver.displayName} is currently in another call` });
      return;
    }

    if (activeUserCalls.has(callerId)) {
      socket.emit("call:failed", { error: "You are already in a call" });
      return;
    }

    const callId = recordCallStart(callerId, receiverId);
    const startedAt = Date.now();

    // 45-second ring timeout
    const timer = setTimeout(() => {
      const active = activeCalls.get(callId);
      if (active && active.status === "ringing") {
        recordCallStatus(callId, "missed");
        activeCalls.delete(callId);
        activeUserCalls.delete(callerId);
        activeUserCalls.delete(receiverId);
        broadcastUserStatusToFriends(callerId);
        broadcastUserStatusToFriends(receiverId);

        socket.emit("call:missed", { callId });
        for (const sockId of receiverSocketSet) {
          io.to(sockId).emit("call:missed", { callId });
        }
      }
    }, 45000);

    activeCalls.set(callId, {
      id: callId,
      callerId,
      receiverId,
      status: "ringing",
      startedAt,
      timer,
    });

    activeUserCalls.set(callerId, callId);
    activeUserCalls.set(receiverId, callId);
    broadcastUserStatusToFriends(callerId);
    broadcastUserStatusToFriends(receiverId);

    // Join caller socket to the call room code
    socket.emit("call:ringing", {
      callId,
      receiver: { id: receiver.id, username: receiver.username, displayName: receiver.displayName },
      role,
    });

    // Notify receiver's active devices
    for (const sockId of receiverSocketSet) {
      io.to(sockId).emit("call:incoming", {
        callId,
        caller: { id: caller.id, username: caller.username, displayName: caller.displayName },
        role: role === "presenter" ? "helper" : "presenter",
      });
    }
  });

  socket.on("call:accept", ({ callId }: { callId: string }) => {
    const active = activeCalls.get(callId);
    if (!active) {
      socket.emit("call:failed", { error: "Call no longer available" });
      return;
    }

    if (active.timer) clearTimeout(active.timer);
    active.status = "connected";
    recordCallStatus(callId, "accepted");

    const caller = getUserById(active.callerId);
    const receiver = getUserById(active.receiverId);

    const callerSockets = userSockets.get(active.callerId);
    if (callerSockets) {
      for (const sockId of callerSockets) {
        io.to(sockId).emit("call:accepted", {
          callId,
          partner: receiver ? { id: receiver.id, username: receiver.username, displayName: receiver.displayName } : null,
        });
      }
    }

    socket.emit("call:connected", {
      callId,
      partner: caller ? { id: caller.id, username: caller.username, displayName: caller.displayName } : null,
    });
  });

  socket.on("call:decline", ({ callId }: { callId: string }) => {
    const active = activeCalls.get(callId);
    if (active) {
      if (active.timer) clearTimeout(active.timer);
      recordCallStatus(callId, "declined");
      activeCalls.delete(callId);
      activeUserCalls.delete(active.callerId);
      activeUserCalls.delete(active.receiverId);
      broadcastUserStatusToFriends(active.callerId);
      broadcastUserStatusToFriends(active.receiverId);

      const callerSockets = userSockets.get(active.callerId);
      if (callerSockets) {
        for (const sockId of callerSockets) {
          io.to(sockId).emit("call:declined", { callId });
        }
      }
    }
  });

  socket.on("call:cancel", ({ callId }: { callId: string }) => {
    const active = activeCalls.get(callId);
    if (active) {
      if (active.timer) clearTimeout(active.timer);
      recordCallStatus(callId, "missed");
      activeCalls.delete(callId);
      activeUserCalls.delete(active.callerId);
      activeUserCalls.delete(active.receiverId);
      broadcastUserStatusToFriends(active.callerId);
      broadcastUserStatusToFriends(active.receiverId);

      const receiverSockets = userSockets.get(active.receiverId);
      if (receiverSockets) {
        for (const sockId of receiverSockets) {
          io.to(sockId).emit("call:cancelled", { callId });
        }
      }
    }
  });

  socket.on("call:end", ({ callId }: { callId: string }) => {
    const active = activeCalls.get(callId);
    if (active) {
      if (active.timer) clearTimeout(active.timer);
      const durationSec = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));
      recordCallStatus(callId, "ended", durationSec);
      activeCalls.delete(callId);
      activeUserCalls.delete(active.callerId);
      activeUserCalls.delete(active.receiverId);
      broadcastUserStatusToFriends(active.callerId);
      broadcastUserStatusToFriends(active.receiverId);

      io.to(callId).emit("call:ended", { callId, durationSec });

      const callerSockets = userSockets.get(active.callerId);
      if (callerSockets) {
        for (const sockId of callerSockets) io.to(sockId).emit("call:ended", { callId, durationSec });
      }
      const receiverSockets = userSockets.get(active.receiverId);
      if (receiverSockets) {
        for (const sockId of receiverSockets) io.to(sockId).emit("call:ended", { callId, durationSec });
      }
    }
  });

  // Standard Room & Signaling events (preserved for room connections and direct calls)
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

  socket.on("disconnect", () => {
    leave(socket);

    const userId = socketUsers.get(socket.id);
    if (userId) {
      socketUsers.delete(socket.id);
      const set = userSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          userSockets.delete(userId);
          updateLastSeen(userId);
          broadcastUserStatusToFriends(userId);

          // If user was in a call, end it
          const callId = activeUserCalls.get(userId);
          if (callId) {
            const active = activeCalls.get(callId);
            if (active) {
              if (active.timer) clearTimeout(active.timer);
              const durationSec = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));
              recordCallStatus(callId, "ended", durationSec);
              activeCalls.delete(callId);
              activeUserCalls.delete(active.callerId);
              activeUserCalls.delete(active.receiverId);
              broadcastUserStatusToFriends(active.callerId);
              broadcastUserStatusToFriends(active.receiverId);
              io.to(callId).emit("call:ended", { callId, durationSec });
            }
          }
        }
      }
    }
  });

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

  socket.on("tracking:set", ({ tracking }: { tracking: TrackingMode }) =>
    mutate((state) => {
      state.tracking = tracking === "sheet" ? "sheet" : "world";
    }),
  );

  socket.on("media:camera", ({ on }: { on: boolean }) =>
    mutate((state) => {
      state.helperCamera = Boolean(on);
    }),
  );

  // A helper tap in world mode: only the presenter's phone knows the 3D scene, so ask it and relay the answer.
  socket.on("world:resolve", (request: WorldResolveRequest, ack: (result: WorldResolveResult) => void) => {
    if (typeof ack !== "function") return;
    const room = currentRoom();
    const presenterId = room && [...room.members.entries()].find(([, role]) => role === "presenter")?.[0];
    const presenter = presenterId ? io.sockets.sockets.get(presenterId) : undefined;
    if (!presenter) return ack({ ok: false, reason: "The presenter isn't in the room." });
    presenter
      .timeout(WORLD_RESOLVE_TIMEOUT_MS)
      .emit("world:resolve", request, (error: Error | null, result: WorldResolveResult) =>
        ack(error || !result ? { ok: false, reason: "The presenter's phone didn't answer." } : result),
      );
  });

  socket.on("world:status", (status: WorldStatus) => {
    const room = currentRoom();
    if (room) socket.volatile.to(room.state.code).emit("world:status", status);
  });

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
    const role = report.role === "presenter" || report.role === "spike" ? report.role : "helper";
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
    if (req.method !== "GET" || req.path.startsWith("/socket.io") || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`RealityCheck server listening on :${PORT}`);
});
