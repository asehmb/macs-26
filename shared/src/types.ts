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
  createdAt: number;
  updatedAt: number;
  start: Vec2;
  end?: Vec2;
};

export type Step = {
  id: string;
  title: string;
  completed: boolean;
};

export type TrackingStatus = "ok" | "lost";

export type PoseFallback = {
  homography: number[] | null;
  ts: number;
  status: TrackingStatus;
};

export type PointerState = {
  position: Vec2 | null;
  ts: number;
};

export type BenchEntry = {
  ts: number;
  metric: string;
  value: number;
  metadata?: Record<string, string | number | boolean>;
};

export type RoomState = {
  code: string;
  annotations: Annotation[];
  steps: Step[];
  currentStepId: string | null;
  pointer: PointerState;
  poseFallback: PoseFallback;
};

export type JoinPayload = {
  code: string;
  role: Role;
};
