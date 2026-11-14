// Package agent orchestrates one register-and-serve session against the
// signaling server, plus the reconnect loop on top.
//
// Phase 4 brings in the WebRTC handshake: on `peer-offer`, build a pion
// answer; trickle ICE both ways. PTY wiring (Phases 5-7) attaches to the
// data channel via DataChannelOpen hook.
package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/peershell/agent/internal/code"
	"github.com/peershell/agent/internal/config"
	"github.com/peershell/agent/internal/modecontrol"
	"github.com/peershell/agent/internal/signaling"
	awebrtc "github.com/peershell/agent/internal/webrtc"
	pion "github.com/pion/webrtc/v4"
)

const (
	reconnectInitialDelay = 1 * time.Second
	reconnectMaxDelay     = 30 * time.Second
)

// Hooks gives tests (and later phases) visibility into session events
// without coupling the orchestration logic to a particular sink.
type Hooks struct {
	OnRegistered     func(code string)
	OnViewerJoining  func(code string)
	OnDataChannel    func(dc *pion.DataChannel) // raw pion DC for Phase 6 wiring
	OnConnectedPeer  func()
	OnSessionEnded   func(err error)
}

type Options struct {
	Config   *config.Config
	Hostname string
	Stdout   io.Writer
	Stderr   io.Writer
	// CodeOverride, when non-empty, replaces the random code generation
	// (used by tests to make assertions deterministic). Empty in prod.
	CodeOverride string
	Hooks        Hooks
	// Mode controls full vs view-only at register time and beyond. May be
	// nil in tests; defaults to full when nil.
	Mode *modecontrol.Controller
}

func currentMode(opts Options) modecontrol.Mode {
	if opts.Mode == nil {
		return modecontrol.Full
	}
	return opts.Mode.Current()
}

// Run is the top-level reconnect loop. It returns ctx.Err() on clean
// shutdown, or any unrecoverable error.
func Run(ctx context.Context, opts Options) error {
	backoff := reconnectInitialDelay
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := session(ctx, opts)
		if err == nil || errors.Is(err, context.Canceled) {
			return nil
		}
		fmt.Fprintf(opts.Stderr, "connection lost: %v — reconnecting in %s\n", err, backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < reconnectMaxDelay {
			backoff *= 2
			if backoff > reconnectMaxDelay {
				backoff = reconnectMaxDelay
			}
		}
	}
}

// session runs exactly one register→serve cycle. It exits on disconnect
// or fatal protocol error; Run wraps it with reconnect.
func session(ctx context.Context, opts Options) (retErr error) {
	pairingCode := opts.CodeOverride
	if pairingCode == "" {
		c, err := code.Generate()
		if err != nil {
			return fmt.Errorf("generate code: %w", err)
		}
		pairingCode = c
	}

	conn, err := signaling.Dial(ctx, opts.Config.Server)
	if err != nil {
		return err
	}
	defer conn.Close()

	mode := currentMode(opts)
	if err := conn.SendRegister(pairingCode, opts.Hostname, mode.String()); err != nil {
		return fmt.Errorf("send register: %w", err)
	}

	ack, err := conn.Read(ctx)
	if err != nil {
		return fmt.Errorf("await registered: %w", err)
	}
	switch ack.Type {
	case "registered":
	case "error":
		return fmt.Errorf("server rejected register: %s", ack.Reason)
	default:
		return fmt.Errorf("unexpected reply to register: %s", ack.Type)
	}

	fmt.Fprintf(opts.Stdout, "● peershell agent running\n")
	fmt.Fprintf(opts.Stdout, "  Machine: %s\n", opts.Hostname)
	fmt.Fprintf(opts.Stdout, "  Code: %s\n", code.Format(pairingCode))
	if opts.Mode != nil {
		fmt.Fprintf(opts.Stdout, "  Mode: %s  (press v to toggle)\n", mode.Pretty())
	} else {
		fmt.Fprintf(opts.Stdout, "  Mode: %s\n", mode.Pretty())
	}
	fmt.Fprintf(opts.Stdout, "  Waiting for connections...\n")

	if opts.Hooks.OnRegistered != nil {
		opts.Hooks.OnRegistered(pairingCode)
	}

	var peer *awebrtc.Peer
	defer func() {
		if peer != nil {
			_ = peer.Close()
		}
		if opts.Mode != nil {
			opts.Mode.Unlock()
		}
		if opts.Hooks.OnSessionEnded != nil {
			opts.Hooks.OnSessionEnded(retErr)
		}
	}()

	for {
		msg, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		switch msg.Type {
		case "viewer-connecting":
			// Lock the mode for the duration of this session. The agent's
			// stdin loop will refuse 'v' toggles until the deferred Unlock
			// runs at session end.
			if opts.Mode != nil {
				opts.Mode.Lock()
			}
			if opts.Hooks.OnViewerJoining != nil {
				opts.Hooks.OnViewerJoining(pairingCode)
			}

		case "peer-offer":
			if msg.Sdp == nil {
				return fmt.Errorf("peer-offer missing sdp")
			}
			p, err := awebrtc.New(opts.Config.Stun)
			if err != nil {
				return fmt.Errorf("create peer: %w", err)
			}
			peer = p
			peer.OnLocalICECandidate(func(c *signaling.IceCandidateInit) {
				if c == nil {
					return // gathering complete
				}
				if err := conn.SendIceCandidate(pairingCode, *c); err != nil {
					fmt.Fprintf(opts.Stderr, "send ice: %v\n", err)
				}
			})
			peer.OnDataChannel(func(dc *pion.DataChannel) {
				dc.OnOpen(func() {
					fmt.Fprintf(opts.Stdout, "✓ data channel open\n")
					bridgeOpts := bridgeOptions{
						shell:    opts.Config.Shell,
						viewOnly: mode == modecontrol.ViewOnly,
					}
					if _, err := bindDataChannelToPTY(dc, bridgeOpts, opts.Stderr); err != nil {
						fmt.Fprintf(opts.Stderr, "bind pty: %v\n", err)
						_ = dc.Close()
						return
					}
				})
				if opts.Hooks.OnDataChannel != nil {
					opts.Hooks.OnDataChannel(dc)
				}
			})
			peer.OnConnectionStateChange(func(s pion.PeerConnectionState) {
				fmt.Fprintf(opts.Stderr, "[webrtc] state=%s\n", s.String())
				if s == pion.PeerConnectionStateConnected && opts.Hooks.OnConnectedPeer != nil {
					opts.Hooks.OnConnectedPeer()
				}
			})
			answer, err := peer.SetRemoteOffer(*msg.Sdp)
			if err != nil {
				return fmt.Errorf("set remote offer: %w", err)
			}
			if err := conn.SendPeerAnswer(pairingCode, answer); err != nil {
				return fmt.Errorf("send answer: %w", err)
			}

		case "ice-candidate":
			if peer == nil || msg.Candidate == nil {
				continue
			}
			if err := peer.AddICECandidate(*msg.Candidate); err != nil {
				fmt.Fprintf(opts.Stderr, "add ice: %v\n", err)
			}

		case "error":
			return fmt.Errorf("server error: %s", msg.Reason)

		default:
			fmt.Fprintf(opts.Stderr, "[signaling] unhandled %s\n", msg.Type)
		}
	}
}
