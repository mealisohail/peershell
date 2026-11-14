package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peershell/agent/internal/agent"
	"github.com/peershell/agent/internal/config"
	"github.com/peershell/agent/internal/modecontrol"
	"github.com/peershell/agent/internal/pty"
)

func main() {
	if hasFlag(os.Args[1:], "--pty-test") {
		if err := runPTYTest(); err != nil {
			log.Fatalf("pty-test: %v", err)
		}
		return
	}

	cfg, err := config.Parse(os.Args[1:], os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown-host"
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	initial := modecontrol.Full
	if cfg.ViewOnly {
		initial = modecontrol.ViewOnly
	}
	mode := modecontrol.New(initial)

	// When the user presses `v` between sessions, re-render the banner so
	// they see the new mode without needing to disconnect/reconnect.
	mode.OnChange(func(m modecontrol.Mode) {
		// Newline so the toggle confirmation doesn't end up mid-banner.
		fmt.Fprintln(os.Stdout)
	})

	// Raw-mode stdin watcher reads single keypresses for the `v` toggle.
	// No-op on non-TTY stdin (CI, piped input).
	stopWatcher, err := modecontrol.WatchStdin(mode, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "warning:", err)
	}
	defer stopWatcher()

	err = agent.Run(ctx, agent.Options{
		Config:   cfg,
		Hostname: hostname,
		Stdout:   os.Stdout,
		Stderr:   os.Stderr,
		Mode:     mode,
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("peershell: %v", err)
	}
}

// hasFlag is a pre-parse probe so --pty-test can short-circuit before any
// other flag handling kicks in.
func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

// runPTYTest spawns the user's shell behind a PTY, runs `ls`, prints the
// captured output verbatim (prompt, echoed input, and all), then exits.
// Standalone — no signaling, no WebRTC.
//
// Per PRD §10 Phase 5: "Standalone test: write `ls\n` to PTY stdin, read
// output, print to stdout."
func runPTYTest() error {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	term, err := pty.Spawn(shell)
	if err != nil {
		return err
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.Copy(os.Stdout, term)
	}()

	// Give the shell a beat to print its prompt before we type.
	time.Sleep(200 * time.Millisecond)
	if _, err := io.WriteString(term, "ls\n"); err != nil {
		_ = term.Close()
		return fmt.Errorf("write ls: %w", err)
	}
	if _, err := io.WriteString(term, "exit\n"); err != nil {
		_ = term.Close()
		return fmt.Errorf("write exit: %w", err)
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = term.Close()
		return errors.New("timed out waiting for shell to exit")
	}
	_ = term.Close()
	return nil
}
