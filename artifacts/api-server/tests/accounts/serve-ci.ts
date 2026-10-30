// Test-only server for an exported copy of the shipped app, not an auth bypass.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import "./check-ci-env";

const root = fileURLToPath(new URL("../../../../generated-artifacts/", import.meta.url));
const app = express();
app.use(express.static(`${root}/accounts-web`));
app.get("/{*path}", (_req, res) => res.sendFile(`${root}/accounts-web/index.html`));
const server = createServer({
  key: readFileSync(`${root}/accounts-tls/key.pem`),
  cert: readFileSync(`${root}/accounts-tls/cert.pem`),
}, app);
server.listen(4173, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
