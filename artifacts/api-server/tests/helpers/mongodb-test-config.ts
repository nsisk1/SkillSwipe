import assert from "node:assert/strict";

// Only explicit test settings are accepted; never fall back to app credentials.
export function getMongoTestConfig(
  env: NodeJS.ProcessEnv,
  required = false,
): { uri: string; databaseName: string } | undefined {
  const uri = env.SKILLSWIPE_TEST_MONGODB_URI?.trim();
  const databaseName = env.SKILLSWIPE_TEST_MONGODB_DATABASE?.trim();
  if (!required && !uri && !databaseName) return undefined;

  assert.ok(uri, "Set SKILLSWIPE_TEST_MONGODB_URI to a disposable local MongoDB instance.");
  assert.equal(
    databaseName,
    "skillswipe_test",
    "SKILLSWIPE_TEST_MONGODB_DATABASE must be exactly skillswipe_test.",
  );

  // Do not include the supplied URI in errors (it could contain credentials).
  let target: URL;
  try {
    target = new URL(uri);
  } catch {
    throw new Error("The test MongoDB URI must be a valid local MongoDB URL.");
  }
  assert.ok(
    target.protocol === "mongodb:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
      !target.username && !target.password && !target.search && !target.hash,
    "Tests only accept a single loopback MongoDB host without credentials or URI options.",
  );
  assert.ok(
    target.pathname === "/" || target.pathname === "" ||
      target.pathname === "/skillswipe_test",
    "The test MongoDB URI must not target a different database.",
  );
  return { uri, databaseName };
}
