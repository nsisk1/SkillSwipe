import assert from "node:assert/strict";
import { test } from "node:test";
import { getMongoTestConfig } from "./helpers/mongodb-test-config";

const valid = {
  SKILLSWIPE_TEST_MONGODB_URI: "mongodb://127.0.0.1:27018/skillswipe_test",
  SKILLSWIPE_TEST_MONGODB_DATABASE: "skillswipe_test",
};

test("MongoDB checks are optional locally but mandatory for release checks", () => {
  assert.equal(getMongoTestConfig({}), undefined);
  assert.throws(() => getMongoTestConfig({}, true));
  assert.throws(() => getMongoTestConfig({
    SKILLSWIPE_TEST_MONGODB_DATABASE: "skillswipe_test",
  }));
  assert.throws(() => getMongoTestConfig({
    SKILLSWIPE_TEST_MONGODB_URI: valid.SKILLSWIPE_TEST_MONGODB_URI,
  }));
  assert.deepEqual(getMongoTestConfig(valid, true), {
    uri: valid.SKILLSWIPE_TEST_MONGODB_URI,
    databaseName: "skillswipe_test",
  });
});

test("MongoDB checks never use the application database configuration", () => {
  const appEnv = { MONGODB_URI: "mongodb://production.example/app" };
  assert.equal(getMongoTestConfig(appEnv), undefined);
  assert.throws(() => getMongoTestConfig(appEnv, true));
});

test("MongoDB checks reject remote servers and unsafe URI variants before connecting", () => {
  for (const uri of [
    "not-a-url",
    "mongodb+srv://production.example/skillswipe_test",
    "mongodb://production.example/skillswipe_test",
    "mongodb://127.0.0.1/production",
    "mongodb://127.0.0.1/%73killswipe_test",
    "mongodb://127.0.0.1,production.example/skillswipe_test",
    "mongodb://127.0.0.1/skillswipe_test?replicaSet=production",
    "mongodb://user:password@127.0.0.1/skillswipe_test",
    "https://127.0.0.1/skillswipe_test",
    "mongodb://127.0.0.1/skillswipe_test#fragment",
  ]) {
    assert.throws(() => getMongoTestConfig({
      ...valid, SKILLSWIPE_TEST_MONGODB_URI: uri,
    }, true));
  }
  assert.throws(() => getMongoTestConfig({
    ...valid, SKILLSWIPE_TEST_MONGODB_DATABASE: "production",
  }, true));
});
