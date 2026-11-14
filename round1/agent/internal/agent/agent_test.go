package agent_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/peershell/agent/internal/agent"
	"github.com/peershell/agent/internal/config"
	"github.com/peershell/agent/internal/signaling"
	pion "github.com/pion/webrtc/v4"
)

// TestPhase4HandshakeDataChannelOpens spins up the real (Node/tsx) signaling
// server, runs an agent in-process, and simulates the browser viewer with a
// second pion PeerConnection. The handshake is considered successful when
// the data channel opens on both peers.
//
// This is the PRD §10 Phase 4 verification ("Both sides log 'data channel
// open'") plus the PRD §11 integration test ("spins up the signaling
// server, runs an agent, and uses pion to simulate a viewer").
//
// Requires Node + tsx available locally.
func TestPhase4HandshakeDataChannelOpens(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not available — skipping integration test")
	}

	signalingURL, stop := startSignalingServer(t)
	t.Cleanup(stop)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const fixedCode = "246810"

	agentDCOpen := make(chan struct{}, 1)
	agentRegistered := make(chan struct{}, 1)

	cfg := &config.Config{
		Server: signalingURL,
		Shell:  "/bin/sh",
		Stun:   "",
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		err := agent.Run(ctx, agent.Options{
			Config:       cfg,
			Hostname:     "integration-test-host",
			Stdout:       io.Discard,
			Stderr:       io.Discard,
			CodeOverride: fixedCode,
			Hooks: agent.Hooks{
				OnRegistered: func(_ string) {
					select {
					case agentRegistered <- struct{}{}:
					default:
					}
				},
				OnDataChannel: func(dc *pion.DataChannel) {
					dc.OnOpen(func() {
						select {
						case agentDCOpen <- struct{}{}:
						default:
						}
					})
				},
			},
		})
		if err != nil && ctx.Err() == nil {
			t.Logf("agent.Run returned: %v", err)
		}
	}()

	select {
	case <-agentRegistered:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for agent to register")
	}

	viewerDCOpen := make(chan struct{}, 1)
	viewer, err := runFakeViewer(ctx, signalingURL, fixedCode, viewerDCOpen)
	if err != nil {
		t.Fatalf("viewer: %v", err)
	}
	t.Cleanup(viewer.close)

	select {
	case <-viewerDCOpen:
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for viewer data channel to open")
	}
	select {
	case <-agentDCOpen:
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for agent data channel to open")
	}

	cancel()
	wg.Wait()
}

// TestPhase6PTYBridgeEchoesShellOutput is the PRD §10 Phase 6 verification.
// After the data channel is open, the viewer sends bytes that should reach
// the agent's PTY stdin; the PTY's reply must come back over the channel.
func TestPhase6PTYBridgeEchoesShellOutput(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm not available — skipping integration test")
	}
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh not available")
	}

	signalingURL, stop := startSignalingServer(t)
	t.Cleanup(stop)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const fixedCode = "135790"

	agentRegistered := make(chan struct{}, 1)
	cfg := &config.Config{Server: signalingURL, Shell: "/bin/sh", Stun: ""}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = agent.Run(ctx, agent.Options{
			Config:       cfg,
			Hostname:     "phase6-test",
			Stdout:       io.Discard,
			Stderr:       io.Discard,
			CodeOverride: fixedCode,
			Hooks: agent.Hooks{
				OnRegistered: func(_ string) {
					select {
					case agentRegistered <- struct{}{}:
					default:
					}
				},
			},
		})
	}()

	select {
	case <-agentRegistered:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for agent to register")
	}

	viewerDCOpen := make(chan struct{}, 1)
	viewer, err := runFakeViewer(ctx, signalingURL, fixedCode, viewerDCOpen)
	if err != nil {
		t.Fatalf("viewer: %v", err)
	}
	t.Cleanup(viewer.close)

	// Capture every binary frame the agent's PTY sends back.
	received := make(chan []byte, 64)
	viewer.dc.OnMessage(func(msg pion.DataChannelMessage) {
		if msg.IsString {
			return
		}
		chunk := make([]byte, len(msg.Data))
		copy(chunk, msg.Data)
		select {
		case received <- chunk:
		default:
		}
	})

	select {
	case <-viewerDCOpen:
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for viewer data channel to open")
	}

	// Give the PTY a beat to print its initial prompt before we type.
	time.Sleep(300 * time.Millisecond)

	const marker = "hi-from-pty"
	if err := viewer.dc.Send([]byte("stty -echo\nprintf " + marker + "\n")); err != nil {
		t.Fatalf("dc send: %v", err)
	}

	var acc []byte
	deadline := time.After(5 * time.Second)
	for {
		select {
		case chunk := <-received:
			acc = append(acc, chunk...)
			if bytes.Contains(acc, []byte(marker)) {
				cancel()
				wg.Wait()
				return
			}
		case <-deadline:
			t.Fatalf("never saw %q in DC output; got %q", marker, string(acc))
		}
	}
}

// fakeViewer is a pion-backed simulation of the browser viewer for tests.
type fakeViewer struct {
	ws *websocket.Conn
	pc *pion.PeerConnection
	dc *pion.DataChannel
}

func (v *fakeViewer) close() {
	if v.dc != nil {
		_ = v.dc.Close()
	}
	if v.pc != nil {
		_ = v.pc.Close()
	}
	if v.ws != nil {
		_ = v.ws.Close()
	}
}

// runFakeViewer plays the role of the browser: WS-connects, sends connect,
// creates a pion PeerConnection and data channel, exchanges offer/answer
// and ICE candidates through the signaling channel, and signals
// `dcOpen` once the channel reaches the OPEN state.
func runFakeViewer(ctx context.Context, signalingURL, code string, dcOpen chan<- struct{}) (*fakeViewer, error) {
	dialer := websocket.DefaultDialer
	ws, _, err := dialer.DialContext(ctx, signalingURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	send := func(m signaling.Message) error {
		return ws.WriteJSON(m)
	}

	if err := send(signaling.Message{Type: "connect", Role: "viewer", Code: code}); err != nil {
		_ = ws.Close()
		return nil, fmt.Errorf("send connect: %w", err)
	}

	pc, err := pion.NewPeerConnection(pion.Configuration{})
	if err != nil {
		_ = ws.Close()
		return nil, fmt.Errorf("new peer: %w", err)
	}

	dc, err := pc.CreateDataChannel("peershell", nil)
	if err != nil {
		_ = pc.Close()
		_ = ws.Close()
		return nil, fmt.Errorf("create dc: %w", err)
	}
	dc.OnOpen(func() {
		select {
		case dcOpen <- struct{}{}:
		default:
		}
	})

	pc.OnICECandidate(func(c *pion.ICECandidate) {
		if c == nil {
			return
		}
		init := c.ToJSON()
		_ = send(signaling.Message{
			Type:   "ice-candidate",
			Code:   code,
			Target: "agent",
			Candidate: &signaling.IceCandidateInit{
				Candidate:        init.Candidate,
				SDPMid:           init.SDPMid,
				SDPMLineIndex:    init.SDPMLineIndex,
				UsernameFragment: init.UsernameFragment,
			},
		})
	})

	// Drive the inbound message loop in a goroutine — signaling messages
	// arrive interleaved with our outbound sends. The caller owns the ws
	// and pc lifecycles via the returned fakeViewer.
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			_, raw, err := ws.ReadMessage()
			if err != nil {
				return
			}
			var msg signaling.Message
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}
			switch msg.Type {
			case "agent-ready":
				offer, err := pc.CreateOffer(nil)
				if err != nil {
					return
				}
				if err := pc.SetLocalDescription(offer); err != nil {
					return
				}
				_ = send(signaling.Message{
					Type: "peer-offer",
					Code: code,
					Sdp:  &signaling.SdpInit{Type: "offer", SDP: offer.SDP},
				})
			case "peer-answer":
				if msg.Sdp == nil {
					return
				}
				_ = pc.SetRemoteDescription(pion.SessionDescription{
					Type: pion.SDPTypeAnswer,
					SDP:  msg.Sdp.SDP,
				})
			case "ice-candidate":
				if msg.Candidate == nil {
					continue
				}
				_ = pc.AddICECandidate(pion.ICECandidateInit{
					Candidate:        msg.Candidate.Candidate,
					SDPMid:           msg.Candidate.SDPMid,
					SDPMLineIndex:    msg.Candidate.SDPMLineIndex,
					UsernameFragment: msg.Candidate.UsernameFragment,
				})
			case "error":
				return
			}
		}
	}()

	return &fakeViewer{ws: ws, pc: pc, dc: dc}, nil
}

// startSignalingServer launches the Node signaling server on a free port via
// `npm start`. It blocks until "signaling listening" appears on stdout and
// returns the ws:// URL plus a cleanup func.
func startSignalingServer(t *testing.T) (string, func()) {
	t.Helper()

	port := freePort(t)

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	signalingDir := filepath.Join(wd, "..", "..", "..", "signaling")
	if _, err := os.Stat(filepath.Join(signalingDir, "package.json")); err != nil {
		t.Fatalf("signaling dir not found at %s", signalingDir)
	}

	cmd := exec.Command("npm", "start", "--silent")
	cmd.Dir = signalingDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", port),
		"LOG_LEVEL=warn",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		t.Fatalf("start signaling: %v", err)
	}

	// Drain stdout to avoid pipe back-pressure killing the child later.
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			_ = scanner.Text()
		}
	}()

	deadline := time.Now().Add(15 * time.Second)
	for {
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			t.Fatalf("signaling did not become ready on port %d", port)
		}
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond)
		if err == nil {
			_ = c.Close()
			break
		}
		time.Sleep(150 * time.Millisecond)
	}

	url := fmt.Sprintf("ws://127.0.0.1:%d/ws", port)
	stop := func() {
		_ = cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			_ = cmd.Process.Kill()
		}
	}
	return url, stop
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port
}
