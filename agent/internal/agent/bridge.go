package agent

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/peershell/agent/internal/pty"
	pion "github.com/pion/webrtc/v4"
)

// bridgeOptions are the per-session knobs the agent passes when wiring a
// data channel to a PTY. Held as a struct so adding flags later doesn't
// keep growing the function signature.
type bridgeOptions struct {
	shell    string
	viewOnly bool
}

// bindDataChannelToPTY spawns a shell behind a PTY and wires it to the
// supplied data channel:
//
//   - Binary frames from the viewer → bytes into the PTY (stdin), UNLESS
//     the session is view-only, in which case binary frames are logged
//     and dropped (defense in depth — the viewer UI also enforces this)
//   - PTY output (stdout/stderr) → binary frames sent on the data channel
//   - Text frames `{type:"resize", cols, rows}` → ioctl on the PTY
//     (still honoured in view-only mode so the viewer's window can resize)
//   - DC close → kill + reap the shell
//
// Returns the *Terminal so the caller can attach lifecycle hooks; ownership
// passes to the data channel handlers — the caller should NOT close it.
func bindDataChannelToPTY(dc *pion.DataChannel, opts bridgeOptions, stderr io.Writer) (*pty.Terminal, error) {
	term, err := pty.Spawn(opts.shell)
	if err != nil {
		return nil, fmt.Errorf("spawn pty: %w", err)
	}

	// PTY → data channel.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := term.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				if sendErr := dc.Send(chunk); sendErr != nil {
					fmt.Fprintf(stderr, "[bridge] dc send: %v\n", sendErr)
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	dc.OnMessage(func(msg pion.DataChannelMessage) {
		if msg.IsString {
			// Control frames (resize) flow regardless of mode.
			handleControlFrame(term, msg.Data, stderr)
			return
		}
		if opts.viewOnly {
			// View-only sessions drop user keystrokes here as a defense
			// in depth check; the viewer's UI also blocks input. Log
			// rather than silently swallow so unexpected traffic surfaces.
			fmt.Fprintf(stderr, "[bridge] dropping %d input bytes in view-only mode\n", len(msg.Data))
			return
		}
		if _, err := term.Write(msg.Data); err != nil {
			fmt.Fprintf(stderr, "[bridge] pty write: %v\n", err)
		}
	})

	dc.OnClose(func() {
		_ = term.Close()
	})

	return term, nil
}

type resizeMsg struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

func handleControlFrame(term *pty.Terminal, data []byte, stderr io.Writer) {
	var msg resizeMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		fmt.Fprintf(stderr, "[bridge] bad control frame: %v\n", err)
		return
	}
	switch msg.Type {
	case "resize":
		if msg.Cols == 0 || msg.Rows == 0 {
			return
		}
		if err := term.Resize(msg.Cols, msg.Rows); err != nil {
			fmt.Fprintf(stderr, "[bridge] resize: %v\n", err)
		}
	default:
		fmt.Fprintf(stderr, "[bridge] unknown control type %q\n", msg.Type)
	}
}
