// Package signaling is the agent's WebSocket client for the signaling server.
//
// Phase 2 scope: dial, send register, read messages back. The wire types
// mirror signaling/src/protocol.ts — keep them in sync.
package signaling

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gorilla/websocket"
)

// SdpInit mirrors RTCSessionDescriptionInit.
type SdpInit struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

// IceCandidateInit mirrors RTCIceCandidateInit and matches pion's
// webrtc.ICECandidateInit field-for-field for direct conversion.
type IceCandidateInit struct {
	Candidate        string  `json:"candidate"`
	SDPMid           *string `json:"sdpMid,omitempty"`
	SDPMLineIndex    *uint16 `json:"sdpMLineIndex,omitempty"`
	UsernameFragment *string `json:"usernameFragment,omitempty"`
}

// Message is a union shape covering every server→client message we care about
// plus the fields we send. Optional fields use omitempty.
type Message struct {
	Type      string            `json:"type"`
	Code      string            `json:"code,omitempty"`
	Role      string            `json:"role,omitempty"`
	Hostname  string            `json:"hostname,omitempty"`
	Mode      string            `json:"mode,omitempty"` // "full" | "view-only"
	Sdp       *SdpInit          `json:"sdp,omitempty"`
	Candidate *IceCandidateInit `json:"candidate,omitempty"`
	Target    string            `json:"target,omitempty"`
	Reason    string            `json:"reason,omitempty"`
}

// Conn is one live connection to the signaling server.
type Conn struct {
	ws *websocket.Conn
}

// Dial opens a WS connection to the signaling server.
func Dial(ctx context.Context, url string) (*Conn, error) {
	d := websocket.DefaultDialer
	ws, _, err := d.DialContext(ctx, url, nil)
	if err != nil {
		return nil, fmt.Errorf("signaling: dial %s: %w", url, err)
	}
	return &Conn{ws: ws}, nil
}

// SendRegister sends an agent register message. `mode` is "full" or
// "view-only"; pass an empty string to omit it (server defaults to full).
func (c *Conn) SendRegister(code, hostname, mode string) error {
	return c.write(Message{
		Type:     "register",
		Role:     "agent",
		Code:     code,
		Hostname: hostname,
		Mode:     mode,
	})
}

// SendPeerAnswer forwards an SDP answer for the given code.
func (c *Conn) SendPeerAnswer(code string, sdp SdpInit) error {
	return c.write(Message{Type: "peer-answer", Code: code, Sdp: &sdp})
}

// SendIceCandidate forwards an ICE candidate to the viewer.
func (c *Conn) SendIceCandidate(code string, cand IceCandidateInit) error {
	return c.write(Message{
		Type:      "ice-candidate",
		Code:      code,
		Candidate: &cand,
		Target:    "viewer",
	})
}

// SendUnregister releases the code at the server.
func (c *Conn) SendUnregister(code string) error {
	return c.write(Message{Type: "unregister", Code: code})
}

// Read blocks until the next server message, the context is cancelled, or
// the connection drops.
func (c *Conn) Read(ctx context.Context) (Message, error) {
	type result struct {
		msg Message
		err error
	}
	ch := make(chan result, 1)
	go func() {
		var m Message
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			ch <- result{err: err}
			return
		}
		if err := json.Unmarshal(data, &m); err != nil {
			ch <- result{err: fmt.Errorf("signaling: decode: %w", err)}
			return
		}
		ch <- result{msg: m}
	}()
	select {
	case <-ctx.Done():
		_ = c.ws.Close()
		return Message{}, ctx.Err()
	case r := <-ch:
		return r.msg, r.err
	}
}

// Close shuts the underlying WebSocket.
func (c *Conn) Close() error {
	if c.ws == nil {
		return nil
	}
	return c.ws.Close()
}

func (c *Conn) write(m Message) error {
	if c.ws == nil {
		return errors.New("signaling: nil conn")
	}
	return c.ws.WriteJSON(m)
}
