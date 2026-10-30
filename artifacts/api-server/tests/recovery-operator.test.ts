import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticateRecoveryOperator } from "../src/lib/recovery-operator";

const backend = () => ({
  verify: async (_token: string) => ({ sub: "user_operator", sid: "sess_verified" }),
  session: async (_id: string) => ({ status: "active", userId: "user_operator" }),
  user: async (_id: string) => ({ privateMetadata: { legacyRecoveryOperator: true } }),
});

test("operator identity comes only from verified token and live server-managed permission", async () => {
  assert.equal(await authenticateRecoveryOperator("session-token", backend()), "user_operator");
  await assert.rejects(authenticateRecoveryOperator("", backend()));
  await assert.rejects(authenticateRecoveryOperator("invalid", {
    ...backend(), verify: async () => { throw new Error("Invalid signature"); },
  }));
  await assert.rejects(authenticateRecoveryOperator("expired", {
    ...backend(), verify: async () => { throw new Error("Expired"); },
  }));
  await assert.rejects(authenticateRecoveryOperator("token", {
    ...backend(), verify: async () => ({ sub: "user_operator" }),
  }));
  for (const status of ["revoked", "ended", "expired"]) {
    await assert.rejects(authenticateRecoveryOperator("token", {
      ...backend(), session: async () => ({ status, userId: "user_operator" }),
    }));
  }
  await assert.rejects(authenticateRecoveryOperator("token", {
    ...backend(), session: async () => ({ status: "active", userId: "user_other" }),
  }));
  for (const metadata of [{}, { legacyRecoveryOperator: false }, { legacyRecoveryOperator: "true" }]) {
    await assert.rejects(authenticateRecoveryOperator("token", {
      ...backend(), user: async () => ({ privateMetadata: metadata }),
    }));
  }
  await assert.rejects(authenticateRecoveryOperator("token", {
    ...backend(), user: async () => { throw new Error("Clerk unavailable"); },
  }));
});
