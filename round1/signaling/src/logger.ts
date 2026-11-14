// Thin logging wrapper. The signaling server never sees terminal payloads
// (those flow over the P2P data channel), so structured logs at info+ are safe.
//
// NEVER log full SDP bodies in production — they include candidates and would
// fill logs with low-value churn. The agent/viewer truncation is intentional.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configured = (process.env["LOG_LEVEL"] ?? "info").toLowerCase() as Level;
const threshold = LEVEL_RANK[configured] ?? LEVEL_RANK.info;

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < threshold) return;
  const record = { ts: new Date().toISOString(), level, msg, ...(fields ?? {}) };
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
