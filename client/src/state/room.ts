import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { Annotation, PointerState, PoseFallback, RoomState, Step } from "../../../shared/src/types";

type RoomStore = {
  socket: Socket | null;
  roomCode: string;
  state: RoomState | null;
  peerCount: number;
  connect: (roomCode: string, role: "presenter" | "helper") => void;
  disconnect: () => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation) => void;
  deleteAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  setSteps: (steps: Step[]) => void;
  advanceStep: () => void;
  toggleStep: (stepId: string) => void;
  sendPointer: (pointer: PointerState) => void;
  sendPoseFallback: (pose: PoseFallback) => void;
};

const createDefaultState = (roomCode: string): RoomState => ({
  code: roomCode,
  annotations: [],
  steps: [],
  currentStepId: null,
  pointer: { position: null, ts: Date.now() },
  poseFallback: { homography: null, status: "lost", ts: Date.now() },
});

export const useRoomStore = create<RoomStore>((set, get) => ({
  socket: null,
  roomCode: "",
  state: null,
  peerCount: 1,
  connect: (roomCode, role) => {
    const socket = io(window.location.origin, { path: "/socket.io" });
    socket.on("connect", () => {
      socket.emit("room:join", { code: roomCode, role });
      set({ roomCode, state: createDefaultState(roomCode) });
    });
    socket.on("state:sync", (state: RoomState) => set({ state }));
    socket.on("room:presence", ({ members }: { members: number }) => set({ peerCount: members }));
    socket.on("pointer:move", (pointer: PointerState) =>
      set((store) => ({ state: store.state ? { ...store.state, pointer } : null })),
    );
    socket.on("pose:fallback", (poseFallback: PoseFallback) =>
      set((store) => ({ state: store.state ? { ...store.state, poseFallback } : null })),
    );
    set({ socket, roomCode });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, roomCode: "", state: null, peerCount: 1 });
  },
  addAnnotation: (annotation) => get().socket?.emit("ann:add", { ...annotation, code: get().roomCode }),
  updateAnnotation: (annotation) => get().socket?.emit("ann:update", { ...annotation, code: get().roomCode }),
  deleteAnnotation: (id) => get().socket?.emit("ann:delete", { id, code: get().roomCode }),
  clearAnnotations: () => get().socket?.emit("ann:clear", { code: get().roomCode }),
  setSteps: (steps) => get().socket?.emit("steps:set", { code: get().roomCode, steps }),
  advanceStep: () => get().socket?.emit("steps:advance", { code: get().roomCode }),
  toggleStep: (stepId) => get().socket?.emit("steps:complete", { code: get().roomCode, stepId }),
  sendPointer: (pointer) => get().socket?.emit("pointer:move", { code: get().roomCode, pointer }),
  sendPoseFallback: (pose) => get().socket?.emit("pose:fallback", { code: get().roomCode, pose }),
}));
