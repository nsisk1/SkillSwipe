import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getMongoTestConfig } from "../tests/helpers/mongodb-test-config";

// Fail before running any tests if the disposable database was not configured.
getMongoTestConfig(process.env, true);
const testsDir = new URL("../tests/", import.meta.url);
const tests = readdirSync(testsDir)
  .filter(name => name.endsWith(".test.ts"))
  .sort()
  .map(name => fileURLToPath(new URL(name, testsDir)));
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...tests], {
  stdio: "inherit",
  env: {
    ...process.env,
    SKILLSWIPE_REQUIRE_TEST_MONGODB: "1",
    // Route tests stub the AI client. Never require real credentials or allow
    // an accidental unstubbed request to reach the paid service in CI.
    AI_INTEGRATIONS_OPENAI_API_KEY: "unused-test-key",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:1",
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
