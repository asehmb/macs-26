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
  /** Target-space millimetres. */
  start: Vec2;
  end?: Vec2;
};

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
