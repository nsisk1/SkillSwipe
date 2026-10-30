import assert from "node:assert/strict";
import { getMongoTestConfig } from "../helpers/mongodb-test-config";

assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"),
  "Set ACCOUNTS_TEST_CLERK_SECRET_KEY to a dedicated development instance key.");
assert.ok(process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_"),
  "Set ACCOUNTS_TEST_CLERK_PUBLISHABLE_KEY to the matching development instance key.");
assert.equal(process.env.ACCOUNTS_TEST_STORAGE, "mongodb");
assert.equal(process.env.ACCOUNTS_TEST_APP_URL, "https://localhost:4173");
getMongoTestConfig(process.env, true);
assert.equal(process.env.AI_INTEGRATIONS_OPENAI_API_KEY, "unused-account-test-key");
assert.equal(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, "http://127.0.0.1:1/never-call-ai");
assert.ok(!process.env.MONGODB_URI, "CI must not receive application database credentials.");
