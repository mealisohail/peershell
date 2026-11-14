package pty

import (
	"bytes"
	"io"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSpawnEchoesWrittenCommand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY is POSIX-only for v1")
	}
	term, err := Spawn("/bin/sh")
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	t.Cleanup(func() { _ = term.Close() })

	// Disable shell echo so we can assert on output only.
	if _, err := io.WriteString(term, "stty -echo\n"); err != nil {
		t.Fatalf("write stty: %v", err)
	}
	if _, err := io.WriteString(term, "printf done-marker\n"); err != nil {
		t.Fatalf("write printf: %v", err)
	}
	out := readUntil(t, term, "done-marker", 3*time.Second)
	if !strings.Contains(out, "done-marker") {
		t.Fatalf("expected output to contain done-marker, got %q", out)
	}
}

func TestCloseTerminatesShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY is POSIX-only for v1")
	}
	term, err := Spawn("/bin/sh")
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	pid := term.Pid()
	if err := term.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// Close must reap the child; if not, the test runner will eventually
	// notice. We can also confirm the pid is no longer alive via Signal(0).
	if alive(pid) {
		t.Fatalf("shell pid %d still alive after Close", pid)
	}
}

func TestResizeReturnsNoError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY is POSIX-only for v1")
	}
	term, err := Spawn("/bin/sh")
	if err != nil {
		t.Fatalf("Spawn: %v", err)
	}
	t.Cleanup(func() { _ = term.Close() })
	if err := term.Resize(120, 40); err != nil {
		t.Fatalf("Resize: %v", err)
	}
}

func TestSpawnEmptyShellErrors(t *testing.T) {
	if _, err := Spawn(""); err == nil {
		t.Fatalf("expected Spawn(\"\") to error")
	}
}

// readUntil reads from r until the buffer contains needle or deadline expires.
func readUntil(t *testing.T, r io.Reader, needle string, deadline time.Duration) string {
	t.Helper()
	buf := &bytes.Buffer{}
	chunk := make([]byte, 1024)
	stop := time.Now().Add(deadline)
	done := make(chan struct{})
	go func() {
		for {
			n, err := r.Read(chunk)
			if n > 0 {
				buf.Write(chunk[:n])
				if strings.Contains(buf.String(), needle) {
					close(done)
					return
				}
			}
			if err != nil {
				close(done)
				return
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Until(stop)):
	}
	return buf.String()
}

func alive(pid int) bool {
	// Send signal 0 — succeeds if pid still exists. Use syscall via the
	// kill(1) command for portability of test-only helper code.
	if pid <= 0 {
		return false
	}
	// Try a tight polling loop: macOS process table may take a moment to
	// reflect the reap.
	for i := 0; i < 20; i++ {
		if err := signalProcess(pid); err != nil {
			return false
		}
		time.Sleep(25 * time.Millisecond)
	}
	return true
}
