import type { SignalMessage } from "../../../shared/src/types";

type Send = (to: string, data: SignalMessage) => void;

const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: String(import.meta.env.VITE_TURN_URL).split(","),
    username: import.meta.env.VITE_TURN_USER,
    credential: import.meta.env.VITE_TURN_PASS,
  });
}

/** Markers need sharp edges on the helper side, so favour resolution and a generous bitrate. */
const VIDEO_MAX_BITRATE = 2_500_000;

function newSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

abstract class Link {
  protected pc: RTCPeerConnection | null = null;
  protected sid: string | null = null;
  protected remoteId: string | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /** Candidates can fire before setLocalDescription resolves; hold them until the SDP is sent. */
  private outgoingCandidates: RTCIceCandidateInit[] = [];
  private descriptionSent = false;

  constructor(
    protected send: Send,
    protected onState: (state: RTCPeerConnectionState | "idle") => void,
  ) {}

  get peerId() {
    return this.remoteId;
  }

  protected createPeer(remoteId: string, sid: string) {
    this.close();
    this.remoteId = remoteId;
    this.sid = sid;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.descriptionSent = false;
    this.outgoingCandidates = [];
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.pc !== pc) return;
      if (this.descriptionSent) this.send(remoteId, { kind: "candidate", sid, candidate: candidate.toJSON() });
      else this.outgoingCandidates.push(candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (this.pc === pc) this.onState(pc.connectionState);
    };
    this.pc = pc;
    this.onState(pc.connectionState);
    if (import.meta.env.DEV) (globalThis as { __rcPeer?: RTCPeerConnection }).__rcPeer = pc;
    return pc;
  }

  protected sendDescription(message: Extract<SignalMessage, { kind: "offer" | "answer" }>) {
    const remoteId = this.remoteId;
    if (!remoteId) return;
    this.send(remoteId, message);
    this.descriptionSent = true;
    for (const candidate of this.outgoingCandidates) {
      this.send(remoteId, { kind: "candidate", sid: message.sid, candidate });
    }
    this.outgoingCandidates = [];
  }

  protected async addCandidate(sid: string, candidate: RTCIceCandidateInit) {
    if (!this.pc || sid !== this.sid) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  protected async flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      await this.pc?.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  close() {
    this.pendingCandidates = [];
    this.outgoingCandidates = [];
    this.descriptionSent = false;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.close();
    }
    this.pc = null;
    this.sid = null;
    this.remoteId = null;
    this.onState("idle");
  }
}

export class PresenterLink extends Link {
  private stream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private retryTimer: number | null = null;

  constructor(
    send: Send,
    onState: (state: RTCPeerConnectionState | "idle") => void,
    private onRemoteAudio: (stream: MediaStream | null) => void,
    private onRemoteVideo: (stream: MediaStream | null) => void = () => undefined,
  ) {
    super(send, onState);
  }

  setStream(stream: MediaStream | null) {
    this.stream = stream;
    const video = stream?.getVideoTracks()[0] ?? null;
    const audio = stream?.getAudioTracks()[0] ?? null;
    if (video) video.contentHint = "detail";
    this.videoSender?.replaceTrack(video).catch(() => undefined);
    this.audioSender?.replaceTrack(audio).catch(() => undefined);
  }

  async connectTo(helperId: string) {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const sid = newSessionId();
    const pc = this.createPeer(helperId, sid);
    const streams = this.stream ? [this.stream] : [];
    const video = this.stream?.getVideoTracks()[0];
    const audio = this.stream?.getAudioTracks()[0];
    if (video) video.contentHint = "detail";

    // sendrecv so the helper can answer with their webcam (picture-in-picture) without renegotiating.
    const videoTransceiver = pc.addTransceiver(video ?? "video", {
      direction: "sendrecv",
      streams,
      sendEncodings: [{ maxBitrate: VIDEO_MAX_BITRATE }],
    });
    const audioTransceiver = pc.addTransceiver(audio ?? "audio", { direction: "sendrecv", streams });
    this.videoSender = videoTransceiver.sender;
    this.audioSender = audioTransceiver.sender;

    pc.ontrack = (event) => {
      if (event.track.kind === "audio") this.onRemoteAudio(new MediaStream([event.track]));
      else this.onRemoteVideo(new MediaStream([event.track]));
    };
    pc.addEventListener("connectionstatechange", () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === "connected") this.tuneSender();
      if (pc.connectionState === "failed") this.scheduleRetry(helperId);
    });

    const offer = await pc.createOffer();
    if (this.pc !== pc) return;
    await pc.setLocalDescription(offer);
    this.sendDescription({ kind: "offer", sid, sdp: pc.localDescription!.toJSON() });
  }

  private scheduleRetry(helperId: string) {
    if (this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.remoteId === helperId) this.connectTo(helperId).catch(() => undefined);
    }, 1500);
  }

  private tuneSender() {
    const sender = this.videoSender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      "maintain-resolution";
    sender.setParameters(params).catch(() => undefined);
  }

  async handleSignal(from: string, data: SignalMessage) {
    if (data.kind === "request-offer") {
      await this.connectTo(from);
      return;
    }
    if (from !== this.remoteId || !this.pc) return;
    if (data.kind === "answer" && data.sid === this.sid && this.pc.signalingState === "have-local-offer") {
      await this.pc.setRemoteDescription(data.sdp);
      await this.flushCandidates();
    } else if (data.kind === "candidate") {
      await this.addCandidate(data.sid, data.candidate);
    }
  }

  close() {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.videoSender = null;
    this.audioSender = null;
    super.close();
    this.onRemoteAudio?.(null);
    this.onRemoteVideo?.(null);
  }
}

export class HelperLink extends Link {
  private micTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;

  constructor(
    send: Send,
    onState: (state: RTCPeerConnectionState | "idle") => void,
    private onRemoteStream: (stream: MediaStream | null) => void,
  ) {
    super(send, onState);
  }

  setMicTrack(track: MediaStreamTrack | null) {
    this.micTrack = track;
    this.audioSender?.replaceTrack(track).catch(() => undefined);
  }

  setCameraTrack(track: MediaStreamTrack | null) {
    this.cameraTrack = track;
    this.videoSender?.replaceTrack(track).catch(() => undefined);
  }

  requestOffer(presenterId: string) {
    this.send(presenterId, { kind: "request-offer" });
  }

  async handleSignal(from: string, data: SignalMessage) {
    if (data.kind === "offer") {
      const pc = this.createPeer(from, data.sid);
      const remote = new MediaStream();
      pc.ontrack = (event) => {
        if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
        this.onRemoteStream(event.streams[0] ?? remote);
      };
      await pc.setRemoteDescription(data.sdp);
      for (const transceiver of pc.getTransceivers()) {
        const kind = transceiver.receiver.track.kind;
        if (kind === "audio") {
          transceiver.direction = "sendrecv";
          this.audioSender = transceiver.sender;
          await transceiver.sender.replaceTrack(this.micTrack).catch(() => undefined);
        } else {
          transceiver.direction = "sendrecv";
          this.videoSender = transceiver.sender;
          await transceiver.sender.replaceTrack(this.cameraTrack).catch(() => undefined);
        }
      }
      const answer = await pc.createAnswer();
      if (this.pc !== pc) return;
      await pc.setLocalDescription(answer);
      this.sendDescription({ kind: "answer", sid: data.sid, sdp: pc.localDescription!.toJSON() });
      await this.flushCandidates();
    } else if (data.kind === "candidate" && from === this.remoteId) {
      await this.addCandidate(data.sid, data.candidate);
    }
  }

  close() {
    this.audioSender = null;
    this.videoSender = null;
    super.close();
    this.onRemoteStream?.(null);
  }
}
