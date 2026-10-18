export type Role = "presenter" | "helper";

export type Vec2 = {
  x: number;
  y: number;
};

export type AnnotationType = "pin" | "arrow" | "text";

export type Annotation = {
  id: string;
  type: AnnotationType;
  creatorId: string;
  text?: string;
  stepId?: string;
  /** Server-clock milliseconds, used for sync-latency measurement. */
  createdAt: number;
  updatedAt: number;
  /** Sheet tracking: target-space millimetres. World tracking: where the helper tapped, normalised 0..1 video coordinates. */
  start: Vec2;
  end?: Vec2;
  /** World tracking: ids of the 3D points the presenter's phone resolved and keeps tracking (positions live on the phone). */
  world?: { start: string; end?: string };
};

/** "world": markerless phone tracking (default). "sheet": the printed ArUco target, kept as fallback and benchmark ground truth. */
export type TrackingMode = "world" | "sheet";

export type Step = {
  id: string;
  title: string;
  completed: boolean;
};

export type GuidanceMode = "guided" | "baseline";

export type ColorPreset = "blue" | "green" | "red" | "yellow";

export type VerifyStatus = "aligned" | "not_yet" | "tracking_lost";

export type RoomState = {
  code: string;
  annotations: Annotation[];
  steps: Step[];
  currentStepId: string | null;
  mode: GuidanceMode;
  verifyColor: ColorPreset;
  tracking: TrackingMode;
  /** Whether the helper is sending their webcam, so the presenter only shows the picture-in-picture when there is one. */
  helperCamera: boolean;
};

export type WorldResolveRequest = {
  /** Normalised 0..1 coordinates in the presenter's outgoing video. */
  point: Vec2;
  /** Frame number read from the video frame the helper tapped, if readable. */
  frame?: number | null;
};

export type WorldResolveResult = { ok: true; id: string } | { ok: false; reason: string };

export type WorldStatus = {
  status: "starting" | "normal" | "limited" | "off";
  ts: number;
};

export type PeerInfo = {
  id: string;
  role: Role;
};

export type PointerState = {
  position: Vec2 | null;
  /** "target" positions are millimetres; "video" positions are normalised 0..1 video coordinates. */
  space: "target" | "video";
  ts: number;
};

export type PoseFallback = {
  /** Maps target millimetres to normalised 0..1 video coordinates, or null when the presenter lost the target. */
  homography: number[] | null;
  ts: number;
};

export type VerifyReport = {
  status: VerifyStatus;
  ratio: number;
  ts: number;
};

export type JoinPayload = {
  code: string;
  role: Role;
};

export type SignalMessage =
  | { kind: "offer"; sid: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sid: string; sdp: RTCSessionDescriptionInit }
  | { kind: "candidate"; sid: string; candidate: RTCIceCandidateInit }
  | { kind: "request-offer" };

export type User = {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  lastSeen: number;
};

export type FriendStatus = "online" | "in-call" | "offline";

export type Friend = {
  id: string;
  username: string;
  displayName: string;
  friendSince: number;
  lastSeen: number;
  status: FriendStatus;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
};

export type CallRecord = {
  id: string;
  callerId: string;
  receiverId: string;
  callerUsername: string;
  callerDisplayName: string;
  receiverUsername: string;
  receiverDisplayName: string;
  status: "ringing" | "accepted" | "declined" | "missed" | "ended";
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
};

export type IncomingCall = {
  callId: string;
  caller: {
    id: string;
    username: string;
    displayName: string;
  };
  role: Role;
};

