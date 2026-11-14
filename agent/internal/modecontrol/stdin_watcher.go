// Stdin watcher — puts the agent's own stdin (NOT the spawned PTY) into
// raw mode and reads single keypresses to drive the runtime mode toggle.
//
// Why raw mode: we want `v` to fire without the user pressing Enter,
// matching the banner hint "(press v to toggle)". Raw mode means the
// terminal stops handling line editing, echoing, and signal generation —
// we must therefore re-emit Ctrl-C ourselves so the user can still quit.
//
// Only runs when stdin is actually a TTY. When piped/non-interactive
// (CI, tests, etc.) we skip the watcher entirely; the mode is still
// driven by the --view-only / env-var defaults.
package modecontrol

import (
	"fmt"
	"io"
	"os"
	"syscall"

	"golang.org/x/term"
)

// WatchStdin reads single keypresses from stdin and applies them to the
// controller until ctx is done. Returns a cleanup function that restores
// the previous terminal state — call it on shutdown.
//
// `log` receives a one-line status message every time the mode toggles,
// so the user sees confirmation when they press `v`.
//
// If stdin isn't a TTY, returns a no-op cleanup and the watcher never
// starts.
func WatchStdin(c *Controller, log io.Writer) (cleanup func(), err error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return func() {}, nil
	}

	prev, err := term.MakeRaw(fd)
	if err != nil {
		return func() {}, fmt.Errorf("modecontrol: make raw: %w", err)
	}

	stop := make(chan struct{})
	cleanup = func() {
		select {
		case <-stop:
			// already closed
		default:
			close(stop)
		}
		_ = term.Restore(fd, prev)
	}

	go func() {
		buf := make([]byte, 1)
		for {
			select {
			case <-stop:
				return
			default:
			}
			n, err := os.Stdin.Read(buf)
			if err != nil || n == 0 {
				return
			}
			ch := buf[0]
			switch ch {
			case 'v', 'V':
				next, ok := c.Toggle()
				if ok {
					fmt.Fprintf(log, "\rMode → %s\r\n", next.Pretty())
				} else {
					fmt.Fprintf(log, "\rMode locked (viewer connected); reconnect to change\r\n")
				}
			case 0x03: // Ctrl-C
				_ = syscall.Kill(os.Getpid(), syscall.SIGINT)
				return
			case 0x04: // Ctrl-D / EOF
				_ = syscall.Kill(os.Getpid(), syscall.SIGTERM)
				return
			}
		}
	}()

	return cleanup, nil
}
