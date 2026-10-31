import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export type RecoveryFailureStage = "setup" | "insert" | "transaction" | "commit" | "request";
export type RecoveryOperation = "approval" | "revocation" | "transfer" | "review";

type RecoveryLogSink = {
  error(fields: Record<string, string>, message: string): unknown;
};

// Operational signals are deliberately separate from the private audit history.
// Never accept an error, request, code, identity, or audit document here.
export function reportRecoveryFailure(
  stage: RecoveryFailureStage,
  operation: RecoveryOperation,
  sink: RecoveryLogSink = logger,
): void {
  try {
    const fields = {
      event: "recovery_operation_failed",
      stage: ["setup", "insert", "transaction", "commit", "request"].includes(stage) ? stage : "unknown",
      operation: ["approval", "revocation", "transfer", "review"].includes(operation) ? operation : "unknown",
    };
    // Handle both throwing sinks and rejected asynchronous adapters without
    // blocking, replacing an original error, or changing a successful result.
    void Promise.resolve(sink.error(fields, "Recovery operation unavailable")).catch(() => {});
  } catch {
    // Reporting is best-effort, never part of authorization or persistence.
  }
}
