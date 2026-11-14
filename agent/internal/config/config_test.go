package config

import (
	"testing"
)

func mockEnv(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaultsWhenNoArgsOrEnv(t *testing.T) {
	cfg, err := Parse(nil, mockEnv(nil))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.Server != "ws://localhost:8080/ws" {
		t.Errorf("Server = %q, want ws://localhost:8080/ws", cfg.Server)
	}
	if cfg.Shell != "/bin/bash" {
		t.Errorf("Shell = %q, want /bin/bash", cfg.Shell)
	}
	if cfg.Stun != "stun:stun.l.google.com:19302" {
		t.Errorf("Stun = %q, want stun:stun.l.google.com:19302", cfg.Stun)
	}
}

func TestEnvOverridesDefaults(t *testing.T) {
	env := mockEnv(map[string]string{
		"PEERSHELL_SERVER": "wss://example.com/ws",
		"SHELL":            "/bin/zsh",
		"PEERSHELL_STUN":   "stun:custom:3478",
	})
	cfg, err := Parse(nil, env)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.Server != "wss://example.com/ws" {
		t.Errorf("Server = %q", cfg.Server)
	}
	if cfg.Shell != "/bin/zsh" {
		t.Errorf("Shell = %q", cfg.Shell)
	}
	if cfg.Stun != "stun:custom:3478" {
		t.Errorf("Stun = %q", cfg.Stun)
	}
}

func TestFlagOverridesEnv(t *testing.T) {
	env := mockEnv(map[string]string{
		"PEERSHELL_SERVER": "wss://from-env/ws",
		"SHELL":            "/bin/zsh",
		"PEERSHELL_STUN":   "stun:from-env:3478",
	})
	cfg, err := Parse(
		[]string{
			"--server", "wss://from-flag/ws",
			"--shell", "/bin/dash",
			"--stun", "stun:from-flag:3478",
		},
		env,
	)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.Server != "wss://from-flag/ws" {
		t.Errorf("Server = %q", cfg.Server)
	}
	if cfg.Shell != "/bin/dash" {
		t.Errorf("Shell = %q", cfg.Shell)
	}
	if cfg.Stun != "stun:from-flag:3478" {
		t.Errorf("Stun = %q", cfg.Stun)
	}
}

func TestUnknownFlagReturnsError(t *testing.T) {
	_, err := Parse([]string{"--nope"}, mockEnv(nil))
	if err == nil {
		t.Fatalf("expected error on unknown flag")
	}
}

func TestViewOnlyDefaultsFalse(t *testing.T) {
	cfg, err := Parse(nil, mockEnv(nil))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.ViewOnly {
		t.Fatalf("ViewOnly = true, want false")
	}
}

func TestViewOnlyFromFlag(t *testing.T) {
	cfg, err := Parse([]string{"--view-only"}, mockEnv(nil))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !cfg.ViewOnly {
		t.Fatalf("ViewOnly = false, want true")
	}
}

func TestViewOnlyFromEnv(t *testing.T) {
	env := mockEnv(map[string]string{"PEERSHELL_VIEW_ONLY": "true"})
	cfg, err := Parse(nil, env)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !cfg.ViewOnly {
		t.Fatalf("ViewOnly = false, want true from env")
	}
}

func TestViewOnlyFlagOverridesEnv(t *testing.T) {
	env := mockEnv(map[string]string{"PEERSHELL_VIEW_ONLY": "true"})
	cfg, err := Parse([]string{"--view-only=false"}, env)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if cfg.ViewOnly {
		t.Fatalf("ViewOnly = true, want false (flag should override env)")
	}
}
