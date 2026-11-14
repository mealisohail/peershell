// Package config parses agent flags + env into a single immutable struct.
// Precedence: flag > env > built-in default.
package config

import (
	"flag"
	"fmt"
	"io"
)

type Config struct {
	Server   string
	Shell    string
	Stun     string
	ViewOnly bool
}

const (
	defaultServer = "ws://localhost:8080/ws"
	defaultShell  = "/bin/bash"
	defaultStun   = "stun:stun.l.google.com:19302"
)

func Parse(args []string, env func(string) string) (*Config, error) {
	server := pick(env("PEERSHELL_SERVER"), defaultServer)
	shell := pick(env("SHELL"), defaultShell)
	stun := pick(env("PEERSHELL_STUN"), defaultStun)
	viewOnly := parseBool(env("PEERSHELL_VIEW_ONLY"))

	fs := flag.NewFlagSet("peershell", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&server, "server", server, "signaling server WebSocket URL")
	fs.StringVar(&shell, "shell", shell, "shell to spawn in PTY")
	fs.StringVar(&stun, "stun", stun, "STUN server URL")
	fs.BoolVar(&viewOnly, "view-only", viewOnly,
		"start in view-only mode (viewer cannot type)")

	if err := fs.Parse(args); err != nil {
		return nil, fmt.Errorf("parse flags: %w", err)
	}

	return &Config{
		Server:   server,
		Shell:    shell,
		Stun:     stun,
		ViewOnly: viewOnly,
	}, nil
}

func pick(envVal, def string) string {
	if envVal != "" {
		return envVal
	}
	return def
}

func parseBool(s string) bool {
	switch s {
	case "1", "t", "T", "true", "TRUE", "True", "yes", "YES", "on":
		return true
	default:
		return false
	}
}
