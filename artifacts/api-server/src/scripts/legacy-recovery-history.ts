import { readSync } from "node:fs";
import { runRecoveryHistoryCommand } from "../lib/recovery-history";

process.exitCode = await runRecoveryHistoryCommand(process.argv.slice(2), {
  readToken: () => {
    if (process.stdin.isTTY) throw new Error("Provide the private operator session on stdin.");
    // Bound input before allocation; JWTs larger than 16 KiB are never valid here.
    const buffer = Buffer.alloc(16385);
    const bytes = readFileSyncBounded(buffer);
    return buffer.subarray(0, bytes).toString("utf8").trim();
  },
  out: text => { process.stdout.write(text); },
  error: text => { process.stderr.write(text); },
});

function readFileSyncBounded(buffer: Buffer): number {
  // See readSync below: do not read an unbounded pipe into memory.
  let total = 0;
  while (total < buffer.length) {
    const count = readSync(0, buffer, total, buffer.length - total, null);
    if (!count) return total;
    total += count;
  }
  throw new Error("Operator session too large.");
}
