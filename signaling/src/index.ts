import { startServer } from "./server.ts";
import { log } from "./logger.ts";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`invalid ${name}: ${raw}`);
  }
  return n;
}

async function main(): Promise<void> {
  const server = await startServer({
    port: envInt("PORT", 8080),
    codeTtlMs: envInt("CODE_TTL_SECONDS", 600) * 1000,
    ratePerMinute: envInt("RATE_LIMIT_PER_MINUTE", 5),
    wrongAttemptsBeforeLockout: envInt("WRONG_ATTEMPTS_LOCKOUT", 3),
    lockoutMs: envInt("LOCKOUT_SECONDS", 60) * 1000,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutting down", { signal });
    try {
      await server.close();
    } catch (err) {
      log.error("shutdown error", { error: String(err) });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
