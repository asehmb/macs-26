import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import type { CallRecord, Friend, FriendRequest, IncomingCall, Role, User } from "../../../shared/src/types";
import { startIncomingRingtone, startRingbackTone, stopAllSounds } from "../utils/sound";

type OutgoingCall = {
  callId: string;
  receiver: {
    id: string;
    username: string;
    displayName: string;
  };
  role: Role;
  status: "calling" | "declined" | "missed";
};

type ActiveCall = {
  callId: string;
  partner: {
    id: string;
    username: string;
    displayName: string;
  };
  role: Role;
};

type FaceTimeStore = {
  user: User | null;
  token: string | null;
  loadingAuth: boolean;
  authError: string | null;
  socket: Socket | null;

  // Friends & data
  friends: Friend[];
  requests: FriendRequest[];
  history: CallRecord[];

  // Calling state
  incomingCall: IncomingCall | null;
  outgoingCall: OutgoingCall | null;
  activeCall: ActiveCall | null;

  // Navigation callback trigger
  navigationTarget: string | null;
  clearNavigationTarget: () => void;

  // Auth actions
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, displayName?: string) => Promise<boolean>;
  logout: () => void;
  initAuth: () => Promise<void>;

  // Friend actions
  loadFriends: () => Promise<void>;
  loadRequests: () => Promise<void>;
  loadHistory: () => Promise<void>;
  sendFriendRequest: (toUsername: string) => Promise<{ success: boolean; message?: string }>;
  respondFriendRequest: (requestId: string, accept: boolean) => Promise<boolean>;
  removeFriend: (friendId: string) => Promise<void>;
  searchUsers: (query: string) => Promise<User[]>;

  // Call actions
  startCall: (friendId: string, role?: Role) => void;
  acceptIncomingCall: () => void;
  declineIncomingCall: () => void;
  cancelOutgoingCall: () => void;
  endCall: () => void;
};

const TOKEN_KEY = "rc_token";

export const useFaceTimeStore = create<FaceTimeStore>((set, get) => {
  const getAuthHeaders = (): Record<string, string> => {
    const token = get().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const initSocket = (token: string) => {
    let socket = get().socket;
    if (!socket || !socket.connected) {
      socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });

      socket.on("connect", () => {
        socket?.emit("auth:init", { token });
      });

      socket.on("friend:status", ({ userId, status }: { userId: string; status: Friend["status"] }) => {
        set((state) => ({
          friends: state.friends.map((f) => (f.id === userId ? { ...f, status } : f)),
        }));
      });

      socket.on("friend:request_received", (req: FriendRequest) => {
        set((state) => ({ requests: [req, ...state.requests.filter((r) => r.id !== req.id)] }));
      });

      socket.on("friend:request_accepted", () => {
        get().loadFriends();
      });

      // Call events
      socket.on("call:incoming", (incoming: IncomingCall) => {
        set({ incomingCall: incoming });
        startIncomingRingtone();
      });

      socket.on("call:ringing", ({ callId, receiver, role }: { callId: string; receiver: OutgoingCall["receiver"]; role: Role }) => {
        set({
          outgoingCall: {
            callId,
            receiver,
            role,
            status: "calling",
          },
        });
        startRingbackTone();
      });

      socket.on("call:accepted", ({ callId, partner }: { callId: string; partner: OutgoingCall["receiver"] }) => {
        stopAllSounds();
        const outgoing = get().outgoingCall;
        const role = outgoing?.role ?? "presenter";
        set({
          outgoingCall: null,
          incomingCall: null,
          activeCall: {
            callId,
            partner,
            role,
          },
          navigationTarget: `/room/${callId}?role=${role}`,
        });
      });

      socket.on("call:connected", ({ callId, partner }: { callId: string; partner: OutgoingCall["receiver"] }) => {
        stopAllSounds();
        const incoming = get().incomingCall;
        const role = incoming?.role ?? "helper";
        set({
          outgoingCall: null,
          incomingCall: null,
          activeCall: {
            callId,
            partner,
            role,
          },
          navigationTarget: `/room/${callId}?role=${role}`,
        });
      });

      socket.on("call:declined", () => {
        stopAllSounds();
        set((state) => (state.outgoingCall ? { outgoingCall: { ...state.outgoingCall, status: "declined" } } : {}));
        window.setTimeout(() => {
          set({ outgoingCall: null });
          get().loadHistory();
        }, 2000);
      });

      socket.on("call:missed", () => {
        stopAllSounds();
        set((state) => (state.outgoingCall ? { outgoingCall: { ...state.outgoingCall, status: "missed" } } : { incomingCall: null }));
        window.setTimeout(() => {
          set({ outgoingCall: null, incomingCall: null });
          get().loadHistory();
        }, 2000);
      });

      socket.on("call:cancelled", () => {
        stopAllSounds();
        set({ incomingCall: null });
        get().loadHistory();
      });

      socket.on("call:ended", () => {
        stopAllSounds();
        set({
          activeCall: null,
          outgoingCall: null,
          incomingCall: null,
          navigationTarget: "/",
        });
        get().loadHistory();
      });

      socket.on("call:failed", ({ error }: { error: string }) => {
        stopAllSounds();
        set({ outgoingCall: null });
        alert(error);
      });

      set({ socket });
    } else {
      socket.emit("auth:init", { token });
    }
  };

  return {
    user: null,
    token: null,
    loadingAuth: true,
    authError: null,
    socket: null,

    friends: [],
    requests: [],
    history: [],

    incomingCall: null,
    outgoingCall: null,
    activeCall: null,

    navigationTarget: null,
    clearNavigationTarget: () => set({ navigationTarget: null }),

    initAuth: async () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (!savedToken) {
        set({ loadingAuth: false });
        return;
      }

      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          set({ user: data.user, token: savedToken, loadingAuth: false });
          initSocket(savedToken);
          get().loadFriends();
          get().loadRequests();
          get().loadHistory();
        } else {
          localStorage.removeItem(TOKEN_KEY);
          set({ user: null, token: null, loadingAuth: false });
        }
      } catch {
        set({ loadingAuth: false });
      }
    },

    login: async (username, password) => {
      set({ authError: null });
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          set({ authError: data.error || "Login failed" });
          return false;
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token, authError: null });
        initSocket(data.token);
        get().loadFriends();
        get().loadRequests();
        get().loadHistory();
        return true;
      } catch (err: unknown) {
        set({ authError: err instanceof Error ? err.message : "Network error" });
        return false;
      }
    },

    register: async (username, password, displayName) => {
      set({ authError: null });
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, displayName }),
        });
        const data = await res.json();
        if (!res.ok) {
          set({ authError: data.error || "Registration failed" });
          return false;
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token, authError: null });
        initSocket(data.token);
        get().loadFriends();
        get().loadRequests();
        get().loadHistory();
        return true;
      } catch (err: unknown) {
        set({ authError: err instanceof Error ? err.message : "Network error" });
        return false;
      }
    },

    logout: () => {
      const token = get().token;
      if (token) {
        fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
      }
      localStorage.removeItem(TOKEN_KEY);
      get().socket?.disconnect();
      stopAllSounds();
      set({
        user: null,
        token: null,
        socket: null,
        friends: [],
        requests: [],
        history: [],
        incomingCall: null,
        outgoingCall: null,
        activeCall: null,
      });
    },

    loadFriends: async () => {
      try {
        const res = await fetch("/api/friends", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          set({ friends: data.friends });
        }
      } catch {
        // Ignored
      }
    },

    loadRequests: async () => {
      try {
        const res = await fetch("/api/friends/requests", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          set({ requests: data.requests });
        }
      } catch {
        // Ignored
      }
    },

    loadHistory: async () => {
      try {
        const res = await fetch("/api/calls/history", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          set({ history: data.history });
        }
      } catch {
        // Ignored
      }
    },

    sendFriendRequest: async (toUsername) => {
      try {
        const res = await fetch("/api/friends/request", {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ toUsername }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, message: data.error || "Failed to send request" };
        }
        if (data.autoAccepted) {
          get().loadFriends();
          return { success: true, message: `Connected! You and @${toUsername} are now friends.` };
        }
        return { success: true, message: `Friend request sent to @${toUsername}!` };
      } catch (err: unknown) {
        return { success: false, message: err instanceof Error ? err.message : "Error sending request" };
      }
    },

    respondFriendRequest: async (requestId, accept) => {
      try {
        const res = await fetch("/api/friends/respond", {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, accept }),
        });
        if (res.ok) {
          set((state) => ({ requests: state.requests.filter((r) => r.id !== requestId) }));
          get().loadFriends();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    removeFriend: async (friendId) => {
      try {
        await fetch(`/api/friends/${friendId}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        set((state) => ({ friends: state.friends.filter((f) => f.id !== friendId) }));
      } catch {
        // Ignored
      }
    },

    searchUsers: async (query) => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          return data.users;
        }
        return [];
      } catch {
        return [];
      }
    },

    startCall: (friendId, role = "presenter") => {
      const socket = get().socket;
      if (!socket) return;
      socket.emit("call:start", { receiverId: friendId, role });
    },

    acceptIncomingCall: () => {
      const incoming = get().incomingCall;
      if (!incoming) return;
      stopAllSounds();
      get().socket?.emit("call:accept", { callId: incoming.callId });
    },

    declineIncomingCall: () => {
      const incoming = get().incomingCall;
      if (!incoming) return;
      stopAllSounds();
      get().socket?.emit("call:decline", { callId: incoming.callId });
      set({ incomingCall: null });
    },

    cancelOutgoingCall: () => {
      const outgoing = get().outgoingCall;
      if (!outgoing) return;
      stopAllSounds();
      get().socket?.emit("call:cancel", { callId: outgoing.callId });
      set({ outgoingCall: null });
    },

    endCall: () => {
      stopAllSounds();
      const active = get().activeCall;
      if (active) {
        get().socket?.emit("call:end", { callId: active.callId });
      }
      set({ activeCall: null, outgoingCall: null, incomingCall: null, navigationTarget: "/" });
    },
  };
});
