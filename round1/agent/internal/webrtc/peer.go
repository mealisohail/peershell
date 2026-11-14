// Package webrtc is a thin wrapper around pion's PeerConnection tailored to
// the agent's role: answerer. The viewer creates the data channel; we
// receive it via OnDataChannel.
//
// Trickle ICE: we return the answer SDP immediately and stream candidates
// through OnICECandidate. The agent ships those over the signaling channel.
package webrtc

import (
	"fmt"

	"github.com/peershell/agent/internal/signaling"
	pion "github.com/pion/webrtc/v4"
)

type Peer struct {
	pc *pion.PeerConnection
}

// New builds a peer connection that answers an incoming offer. stunURL is
// optional; pass "" to skip ICE servers (useful for loopback tests).
func New(stunURL string) (*Peer, error) {
	cfg := pion.Configuration{}
	if stunURL != "" {
		cfg.ICEServers = []pion.ICEServer{{URLs: []string{stunURL}}}
	}
	pc, err := pion.NewPeerConnection(cfg)
	if err != nil {
		return nil, fmt.Errorf("webrtc: new peer: %w", err)
	}
	return &Peer{pc: pc}, nil
}

// SetRemoteOffer installs the viewer's SDP offer and produces the answer
// SDP. Caller must send the returned SdpInit back through signaling.
func (p *Peer) SetRemoteOffer(sdp signaling.SdpInit) (signaling.SdpInit, error) {
	if sdp.Type != "offer" {
		return signaling.SdpInit{}, fmt.Errorf("webrtc: expected offer, got %q", sdp.Type)
	}
	if err := p.pc.SetRemoteDescription(pion.SessionDescription{
		Type: pion.SDPTypeOffer,
		SDP:  sdp.SDP,
	}); err != nil {
		return signaling.SdpInit{}, fmt.Errorf("webrtc: set remote: %w", err)
	}
	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return signaling.SdpInit{}, fmt.Errorf("webrtc: create answer: %w", err)
	}
	if err := p.pc.SetLocalDescription(answer); err != nil {
		return signaling.SdpInit{}, fmt.Errorf("webrtc: set local: %w", err)
	}
	return signaling.SdpInit{Type: "answer", SDP: answer.SDP}, nil
}

// AddICECandidate hands the viewer's candidate to pion.
func (p *Peer) AddICECandidate(cand signaling.IceCandidateInit) error {
	return p.pc.AddICECandidate(pion.ICECandidateInit{
		Candidate:        cand.Candidate,
		SDPMid:           cand.SDPMid,
		SDPMLineIndex:    cand.SDPMLineIndex,
		UsernameFragment: cand.UsernameFragment,
	})
}

// OnLocalICECandidate fires for every locally-gathered candidate (and once
// with nil to signal gathering complete). Convert to wire shape before
// shipping over signaling.
func (p *Peer) OnLocalICECandidate(cb func(*signaling.IceCandidateInit)) {
	p.pc.OnICECandidate(func(c *pion.ICECandidate) {
		if c == nil {
			cb(nil)
			return
		}
		init := c.ToJSON()
		cb(&signaling.IceCandidateInit{
			Candidate:        init.Candidate,
			SDPMid:           init.SDPMid,
			SDPMLineIndex:    init.SDPMLineIndex,
			UsernameFragment: init.UsernameFragment,
		})
	})
}

// OnDataChannel fires when the viewer's data channel arrives. Phase 6 wires
// the PTY to this channel.
func (p *Peer) OnDataChannel(cb func(*pion.DataChannel)) {
	p.pc.OnDataChannel(cb)
}

// OnConnectionStateChange fires on peer-connection state transitions
// (connected, disconnected, failed, closed).
func (p *Peer) OnConnectionStateChange(cb func(pion.PeerConnectionState)) {
	p.pc.OnConnectionStateChange(cb)
}

func (p *Peer) Close() error {
	return p.pc.Close()
}
