//go:build unix

package pty

import "syscall"

// signalProcess returns nil if the pid still exists (signal 0 probe).
func signalProcess(pid int) error {
	return syscall.Kill(pid, 0)
}
