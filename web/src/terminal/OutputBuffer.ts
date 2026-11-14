// Fixed-capacity ring buffer for terminal output bytes. Used by Session to
// replay recent history into newly-attached panes (the "what's already on
// screen" you see when you attach to a same-session tab).
//
// Implementation: single backing Uint8Array of size `capacity`, append by
// copying into the head and incrementing a logical write counter. The
// snapshot reads from the appropriate slice (wrapping around if needed).

export class OutputBuffer {
  private readonly capacity: number;
  private readonly buf: Uint8Array;
  /** Total bytes ever appended — not modulo capacity. */
  private written = 0;

  constructor(capacityBytes: number) {
    if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) {
      throw new Error(`OutputBuffer: capacity must be > 0, got ${capacityBytes}`);
    }
    this.capacity = capacityBytes;
    this.buf = new Uint8Array(capacityBytes);
  }

  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;

    // If the chunk is larger than the buffer, only its tail survives.
    if (chunk.length >= this.capacity) {
      const tail = chunk.subarray(chunk.length - this.capacity);
      this.buf.set(tail, 0);
      this.written += chunk.length;
      return;
    }

    const head = this.written % this.capacity;
    const room = this.capacity - head;
    if (chunk.length <= room) {
      this.buf.set(chunk, head);
    } else {
      this.buf.set(chunk.subarray(0, room), head);
      this.buf.set(chunk.subarray(room), 0);
    }
    this.written += chunk.length;
  }

  byteSize(): number {
    return Math.min(this.written, this.capacity);
  }

  snapshot(): Uint8Array {
    const size = this.byteSize();
    if (size === 0) return new Uint8Array(0);
    const out = new Uint8Array(size);
    if (this.written <= this.capacity) {
      out.set(this.buf.subarray(0, size));
      return out;
    }
    // Wrapped: oldest byte is at `head`, newest is `head - 1` (mod capacity).
    const head = this.written % this.capacity;
    out.set(this.buf.subarray(head), 0);
    out.set(this.buf.subarray(0, head), this.capacity - head);
    return out;
  }

  clear(): void {
    this.written = 0;
    this.buf.fill(0);
  }
}
