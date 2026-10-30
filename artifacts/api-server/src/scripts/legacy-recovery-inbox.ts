import { MongoLegacyRecoveryRequestInbox } from "../lib/legacy-recovery-requests";

const [action, requestId, ...extra] = process.argv.slice(2);
if (
  extra.length || (action !== "list" && action !== "close") ||
  (action === "list" && requestId) ||
  (action === "close" && !/^[0-9a-f-]{36}$/.test(requestId ?? ""))
) {
  process.stderr.write("Usage: tsx src/scripts/legacy-recovery-inbox.ts list | close REQUEST_UUID\n");
  process.exitCode = 1;
} else {
  const inbox = new MongoLegacyRecoveryRequestInbox();
  try {
    if (action === "list") {
      process.stderr.write("PRIVATE SUPPORT INBOX: reply emails are unverified contact details, never ownership proof.\n");
      for await (const request of inbox.listPending()) {
        // Intentional private operator output. Never send to shared logs.
        process.stdout.write(`${JSON.stringify(request)}\n`);
      }
    } else {
      const closed = await inbox.closeRequest(requestId!);
      process.stdout.write(closed ? "Request closed. No deck ownership changed.\n" : "No matching open request.\n");
      if (!closed) process.exitCode = 1;
    }
  } catch {
    process.stderr.write("Support inbox unavailable. Check database configuration and permissions. No action confirmed.\n");
    process.exitCode = 1;
  } finally {
    await inbox.close();
  }
}
