// Package pty spawns a shell behind a pseudoterminal and exposes it as an
// io.ReadWriteCloser. The wrapper owns the child process — Close kills it
// and waits, so the caller does not have to manage pids.
//
// POSIX-only (Linux + macOS). Windows would require ConPTY (out of v1 scope).
package pty

import (
	"errors"
	"fmt"
	"os"
	"os/exec"

	cpty "github.com/creack/pty"
)

type Terminal struct {
	master *os.File
	cmd    *exec.Cmd
}

// Spawn starts shell behind a PTY. shell must be an absolute path to an
// executable (e.g. /bin/bash). The child inherits the parent environment.
func Spawn(shell string) (*Terminal, error) {
	if shell == "" {
		return nil, errors.New("pty: shell path is empty")
	}
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	master, err := cpty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("pty: start %s: %w", shell, err)
	}
	return &Terminal{master: master, cmd: cmd}, nil
}

func (t *Terminal) Read(p []byte) (int, error) {
	return t.master.Read(p)
}

func (t *Terminal) Write(p []byte) (int, error) {
	return t.master.Write(p)
}

// Resize informs the PTY of a new window size. xterm.js sends a (cols, rows)
// pair on every onResize event.
func (t *Terminal) Resize(cols, rows uint16) error {
	return cpty.Setsize(t.master, &cpty.Winsize{Cols: cols, Rows: rows})
}

// Pid returns the shell's pid, exposed for tests and signal handling.
func (t *Terminal) Pid() int {
	if t.cmd == nil || t.cmd.Process == nil {
		return 0
	}
	return t.cmd.Process.Pid
}

// Close kills the shell and releases the master FD. Safe to call multiple
// times; subsequent calls return nil.
func (t *Terminal) Close() error {
	if t == nil || t.master == nil {
		return nil
	}
	if t.cmd != nil && t.cmd.Process != nil {
		// Kill is best-effort; a well-behaved shell exits on master close.
		_ = t.cmd.Process.Kill()
		_, _ = t.cmd.Process.Wait()
	}
	err := t.master.Close()
	t.master = nil
	return err
}
