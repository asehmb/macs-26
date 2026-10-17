import type { Socket } from "socket.io-client";

export type PeerCallbacks = {
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USER,
    credential: import.meta.env.VITE_TURN_PASS,
  });
}

export class RoomPeer {
  private pc: RTCPeerConnection;

  private makingOffer = false;

  private ignoreOffer = false;

  private polite: boolean;

  constructor(
    private socket: Socket,
    private roomCode: string,
    private callbacks: PeerCallbacks,
    private localStream: MediaStream | null,
    polite: boolean,
  ) {
    this.polite = polite;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.bind();
  }

  private bind() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, this.localStream as MediaStream);
      });
    } else {
      this.pc.addTransceiver("video", { direction: "recvonly" });
      this.pc.addTransceiver("audio", { direction: "recvonly" });
    }

    this.pc.ontrack = (event) => {
      this.callbacks.onRemoteStream(event.streams[0]);
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionState(this.pc.connectionState);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      this.socket.emit("signal", {
        to: this.roomCode,
        data: { candidate },
      });
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.socket.emit("signal", {
          to: this.roomCode,
          data: { description: this.pc.localDescription },
        });
      } finally {
        this.makingOffer = false;
      }
    };
  }

  async handleSignal(data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (data.description) {
      const readyForOffer =
        !this.makingOffer &&
        (this.pc.signalingState === "stable" || this.pc.signalingState === "have-local-offer");
      const collision = data.description.type === "offer" && !readyForOffer;

      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) {
        return;
      }
      await this.pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        await this.pc.setLocalDescription();
        this.socket.emit("signal", {
          to: this.roomCode,
          data: { description: this.pc.localDescription },
        });
      }
    } else if (data.candidate && !this.ignoreOffer) {
      await this.pc.addIceCandidate(data.candidate);
    }
  }

  replaceVideoTrack(track: MediaStreamTrack) {
    const sender = this.pc.getSenders().find((item) => item.track?.kind === "video");
    sender?.replaceTrack(track);
  }

  async reconnect() {
    this.pc.restartIce();
  }

  close() {
    this.pc.close();
  }
}
