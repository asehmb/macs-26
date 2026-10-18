import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type {
  Annotation,
  ColorPreset,
  GuidanceMode,
  PeerInfo,
  PointerState,
  PoseFallback,
  Role,
  RoomState,
  SignalMessage,
  Step,
  TrackingMode,
  VerifyReport,
  WorldResolveRequest,
  WorldResolveResult,
  WorldStatus,
} from "../../../shared/src/types";

type SignalHandler = (from: string, data: SignalMessage) => void;
type WorldResolver = (request: WorldResolveRequest) => WorldResolveResult;

const WORLD_RESOLVE_TIMEOUT_MS = 4000;

type RoomStore = {
  socket: Socket | null;
  selfId: string | null;
  roomCode: string;
  role: Role | null;
  connected: boolean;
  state: RoomState | null;
  peers: PeerInfo[];
  /** Remote participant's live pointer; read from the overlay render loop, not via React. */
  pointer: PointerState | null;
  poseFallback: PoseFallback | null;
  verifyReport: VerifyReport | null;
  worldStatus: WorldStatus | null;
  /** serverTime ≈ Date.now() + clockOffset */
  clockOffset: number;
  connect: (roomCode: string, role: Role) => void;
  disconnect: () => void;
  onSignal: (handler: SignalHandler) => () => void;
  sendSignal: (to: string, data: SignalMessage) => void;
  serverNow: () => number;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation) => void;
  deleteAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  setSteps: (steps: Step[]) => void;
  goToStep: (stepId: string) => void;
  setStepCompleted: (stepId: string, completed: boolean) => void;
  setMode: (mode: GuidanceMode) => void;
  setVerifyColor: (color: ColorPreset) => void;
  sendVerifyReport: (report: VerifyReport) => void;
  sendPointer: (pointer: PointerState) => void;
  sendPoseFallback: (pose: PoseFallback) => void;
  setTracking: (tracking: TrackingMode) => void;
  setHelperCamera: (on: boolean) => void;
  sendWorldStatus: (status: WorldStatus) => void;
  /** Helper: ask the presenter's phone to turn a tap on its video into a tracked 3D point. */
  resolveWorldPoint: (request: WorldResolveRequest) => Promise<WorldResolveResult>;
  /** Presenter: answer helpers' world taps. Only one resolver is active at a time. */
  setWorldResolver: (resolver: WorldResolver | null) => void;
};

const signalHandlers = new Set<SignalHandler>();
let worldResolver: WorldResolver | null = null;

async function measureClockOffset(socket: Socket): Promise<number | null> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 5; i += 1) {
    const sent = Date.now();
    const serverTime = await new Promise<number | null>((resolve) => {
      socket.timeout(2000).emit("clock:ping", (err: Error | null, time: number) => resolve(err ? null : time));
    });
    if (serverTime === null) continue;
    const received = Date.now();
    const rtt = received - sent;
    const offset = serverTime - (sent + received) / 2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best?.offset ?? null;
}

export const useRoomStore = create<RoomStore>((set, get) => {
  const emit = (event: string, payload?: unknown) => get().socket?.emit(event, payload);

  return {
    socket: null,
    selfId: null,
    roomCode: "",
    role: null,
    connected: false,
    state: null,
    peers: [],
    pointer: null,
    poseFallback: null,
    verifyReport: null,
    worldStatus: null,
    clockOffset: 0,

    connect: (roomCode, role) => {
      const current = get();
      if (current.socket && current.roomCode === roomCode && current.role === role) return;
      current.socket?.disconnect();

      const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
      socket.on("connect", () => {
        set({ connected: true, selfId: socket.id ?? null });
        socket.emit("room:join", { code: roomCode, role });
        measureClockOffset(socket).then((offset) => {
          if (offset !== null) set({ clockOffset: offset });
        });
      });
      socket.on("disconnect", () => set({ connected: false, peers: [] }));
      socket.on("state:sync", (state: RoomState) => set({ state }));
      socket.on("room:peers", (peers: PeerInfo[]) => set({ peers }));
      // Peers' clocks differ, so freshness is judged by local receipt time.
      socket.on("pointer:move", (pointer: PointerState) => set({ pointer: { ...pointer, ts: Date.now() } }));
      socket.on("pose:fallback", (pose: PoseFallback) => set({ poseFallback: { ...pose, ts: Date.now() } }));
      socket.on("verify:report", (report: VerifyReport) => set({ verifyReport: { ...report, ts: Date.now() } }));
      socket.on("world:status", (status: WorldStatus) => set({ worldStatus: { ...status, ts: Date.now() } }));
      socket.on("world:resolve", (request: WorldResolveRequest, ack: (result: WorldResolveResult) => void) => {
        if (typeof ack !== "function") return;
        try {
          ack(worldResolver?.(request) ?? { ok: false, reason: "World tracking isn't running on the presenter's phone." });
        } catch (error) {
          ack({ ok: false, reason: error instanceof Error ? error.message : String(error) });
        }
      });
      socket.on("signal", ({ from, data }: { from: string; data: SignalMessage }) => {
        signalHandlers.forEach((handler) => handler(from, data));
      });

      set({
        socket,
        roomCode,
        role,
        state: null,
        peers: [],
        pointer: null,
        poseFallback: null,
        verifyReport: null,
        worldStatus: null,
      });
    },

    disconnect: () => {
      get().socket?.disconnect();
      set({ socket: null, selfId: null, roomCode: "", role: null, connected: false, state: null, peers: [] });
    },

    onSignal: (handler) => {
      signalHandlers.add(handler);
      return () => signalHandlers.delete(handler);
    },
    sendSignal: (to, data) => emit("signal", { to, data }),
    serverNow: () => Date.now() + get().clockOffset,

    addAnnotation: (annotation) => emit("ann:add", annotation),
    updateAnnotation: (annotation) => emit("ann:update", annotation),
    deleteAnnotation: (id) => emit("ann:delete", { id }),
    clearAnnotations: () => emit("ann:clear"),
    setSteps: (steps) => emit("steps:set", { steps }),
    goToStep: (stepId) => emit("steps:go", { stepId }),
    setStepCompleted: (stepId, completed) => emit("steps:complete", { stepId, completed }),
    setMode: (mode) => emit("mode:set", { mode }),
    setVerifyColor: (color) => emit("verify:color", { color }),
    sendVerifyReport: (report) => get().socket?.volatile.emit("verify:report", report),
    sendPointer: (pointer) => get().socket?.volatile.emit("pointer:move", pointer),
    sendPoseFallback: (pose) => get().socket?.volatile.emit("pose:fallback", pose),
    setTracking: (tracking) => emit("tracking:set", { tracking }),
    setHelperCamera: (on) => emit("media:camera", { on }),
    sendWorldStatus: (status) => get().socket?.volatile.emit("world:status", status),
    resolveWorldPoint: (request) =>
      new Promise((resolve) => {
        const socket = get().socket;
        if (!socket?.connected) return resolve({ ok: false, reason: "Not connected to the server." });
        socket
          .timeout(WORLD_RESOLVE_TIMEOUT_MS)
          .emit("world:resolve", request, (error: Error | null, result: WorldResolveResult) =>
            resolve(error || !result ? { ok: false, reason: "The presenter's phone didn't answer." } : result),
          );
      }),
    setWorldResolver: (resolver) => {
      worldResolver = resolver;
    },
  };
});
