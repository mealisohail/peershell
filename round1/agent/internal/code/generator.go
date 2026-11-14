// Package code generates and formats the 6-digit pairing codes shown to
// the user. crypto/rand only — never math/rand (PRD §7.1).
package code

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
)

const space uint32 = 1_000_000

// Generate returns a uniformly-random 6-digit numeric string, zero-padded.
func Generate() (string, error) {
	// Rejection sampling on a uint32 to avoid modulo bias against the
	// non-power-of-ten upper range.
	const limit = (^uint32(0)) - ((^uint32(0)) % space)
	var buf [4]byte
	for {
		if _, err := rand.Read(buf[:]); err != nil {
			return "", fmt.Errorf("code: read random: %w", err)
		}
		n := binary.BigEndian.Uint32(buf[:])
		if n < limit {
			return fmt.Sprintf("%06d", n%space), nil
		}
	}
}

// Format inserts a hyphen between the two halves of a 6-digit code for
// display. Returns the input unchanged if it is not exactly 6 characters.
func Format(c string) string {
	if len(c) != 6 {
		return c
	}
	return c[:3] + "-" + c[3:]
}
