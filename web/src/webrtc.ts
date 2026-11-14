// Browser-side WebRTC peer for the viewer role: we create the offer and the
// data channel; the agent answers. Trickle ICE both directions.

import type { IceCandidateInit, SdpInit } from "./signaling.ts";

export type PeerOptions = {
  stunUrl: string;
};

export type PeerHooks = {
  onLocalIceCandidate(candidate: IceCandidateInit): void;
  onChannelOpen(channel: RTCDataChannel): void;
  onConnectionStateChange?(state: RTCPeerConnectionState): void;
};

export class Peer {
  private readonly pc: RTCPeerConnection;
  private readonly channel: RTCDataChannel;

  constructor(opts: PeerOptions, hooks: PeerHooks) {
    this.pc = new RTCPeerConnection({
      iceServers: opts.stunUrl ? [{ urls: opts.stunUrl }] : [],
    });

    this.channel = this.pc.createDataChannel("peershell", {
      ordered: true,
    });
    this.channel.binaryType = "arraybuffer";
    this.channel.addEventListener("open", () => {
      hooks.onChannelOpen(this.channel);
    });

    this.pc.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return; // gathering complete
      const c = event.candidate;
      hooks.onLocalIceCandidate({
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
        usernameFragment: c.usernameFragment,
      });
    });

    if (hooks.onConnectionStateChange) {
      this.pc.addEventListener("connectionstatechange", () => {
        hooks.onConnectionStateChange!(this.pc.connectionState);
      });
    }
  }

  async createOffer(): Promise<SdpInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    if (!offer.sdp || offer.type !== "offer") {
      throw new Error("webrtc: offer missing sdp");
    }
    return { type: "offer", sdp: offer.sdp };
  }

  async setRemoteAnswer(answer: SdpInit): Promise<void> {
    if (answer.type !== "answer") {
      throw new Error(`webrtc: expected answer, got ${answer.type}`);
    }
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  }

  async addRemoteIceCandidate(candidate: IceCandidateInit): Promise<void> {
    await this.pc.addIceCandidate(candidate);
  }

  /**
   * Read-only escape hatch for diagnostics — callers MUST NOT invoke
   * mutating methods (close(), setLocalDescription, etc.) on the returned
   * connection. Intended for getStats(), iceConnectionState reads, and
   * currentLocalDescription / currentRemoteDescription inspection only.
   */
  get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  close(): void {
    try {
      this.channel.close();
    } catch {
      // ignore — channel may already be closing
    }
    this.pc.close();
  }
}
