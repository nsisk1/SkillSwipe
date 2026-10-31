import { MongoLegacyRecoveryRequestInbox } from "./legacy-recovery-requests";
import { logger } from "./logger";

type NotificationConfig = { url: string; token: string };
type NotificationQueue = Pick<MongoLegacyRecoveryRequestInbox, "claimNotification" | "finishNotification">;
type SafeLogger = Pick<typeof logger, "warn" | "info">;

// Configuration is server/operator owned, never taken from a learner request.
export function recoveryNotificationConfig(env: NodeJS.ProcessEnv): NotificationConfig | null {
  const rawUrl = env.RECOVERY_NOTIFICATION_WEBHOOK_URL?.trim();
  const token = env.RECOVERY_NOTIFICATION_WEBHOOK_TOKEN?.trim();
  if (!rawUrl && !token && !env.RECOVERY_NOTIFICATION_PRIVATE_DESTINATION) return null;
  if (!rawUrl || !token || /[\r\n]/.test(token) || env.RECOVERY_NOTIFICATION_PRIVATE_DESTINATION !== "confirmed") {
    throw new Error("Recovery notification configuration is incomplete.");
  }
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Recovery notification endpoint must use HTTPS without URL credentials or fragments.");
  }
  return { url: url.toString(), token };
}

export async function deliverRecoveryNotification(
  config: NotificationConfig,
  request: { requestId: string; createdAt: string },
  send: typeof fetch = fetch,
): Promise<void> {
  const response = await send(config.url, {
    method: "POST",
    redirect: "error", // Never forward credentials to a redirected destination.
    signal: AbortSignal.timeout(5_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "Idempotency-Key": `recovery-request-${request.requestId}`,
    },
    body: JSON.stringify({
      event: "recovery_request.pending",
      requestId: request.requestId,
      createdAt: request.createdAt,
      message: "A private recovery request awaits independent verification. This is not recovery approval. Check the private operator inbox.",
    }),
  });
  // Do not read or log response bodies: they may echo secrets or private data.
  await response.body?.cancel();
  if (!response.ok) throw new Error("Recovery notification delivery was not acknowledged.");
}

export class RecoveryNotificationWorker {
  private running = false;
  constructor(
    private readonly queue: NotificationQueue,
    private readonly deliver: (request: { requestId: string; createdAt: string }) => Promise<void>,
    private readonly log: SafeLogger = logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Bound work per tick; a lease permits safe retries after process crashes.
      for (let count = 0; count < 20; count++) {
        const request = await this.queue.claimNotification(this.now());
        if (!request) break;
        let delivered = false;
        try {
          await this.deliver({ requestId: request.requestId, createdAt: request.createdAt });
          delivered = true;
        } catch {
          this.log.warn("Recovery notification failed; saved requests remain pending and alerts will retry.");
        }
        await this.queue.finishNotification(request.requestId, request.leaseId, delivered, this.now());
        if (delivered) this.log.info("Recovery notification acknowledged; no recovery approved.");
      }
    } catch {
      // Deliberately exclude errors, endpoint, credentials and request contents.
      this.log.warn("Recovery notification queue unavailable; saved requests will be checked again.");
    } finally {
      this.running = false;
    }
  }
}

export function startRecoveryNotifications(env: NodeJS.ProcessEnv = process.env): void {
  let config: NotificationConfig | null;
  try {
    config = recoveryNotificationConfig(env);
  } catch {
    logger.warn("Recovery notifications disabled: check private webhook configuration. Monitor the private inbox manually.");
    return;
  }
  if (!config) {
    logger.warn("Recovery notifications are not configured. Monitor the private inbox manually.");
    return;
  }
  const inbox = new MongoLegacyRecoveryRequestInbox();
  const worker = new RecoveryNotificationWorker(inbox, request => deliverRecoveryNotification(config, request));
  void worker.drain();
  setInterval(() => { void worker.drain(); }, 30_000).unref();
}
