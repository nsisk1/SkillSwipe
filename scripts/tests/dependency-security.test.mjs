import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Exercise the actual transitive dependency Expo loads, not a second test copy.
const mobileRequire = createRequire(
  new URL("../../artifacts/skillswipe/package.json", import.meta.url),
);
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const configRequire = createRequire(expoRequire.resolve("@expo/config/package.json"));
const merge = configRequire("deepmerge");

test("deepmerge cannot change the returned object's prototype via source keys", () => {
  const source = JSON.parse('{"__proto__":{"unexpected":true},"name":"safe"}');
  const result = merge(Object.create(null), source);

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.unexpected, undefined);
  assert.equal(result.name, "safe");
  assert.equal({}.unexpected, undefined);
});

test("deepmerge cannot change the returned object's prototype via target keys", () => {
  const target = JSON.parse('{"__proto__":{"unexpected":true},"name":"safe"}');
  const result = merge(target, { enabled: true });

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.unexpected, undefined);
  assert.equal(result.enabled, true);
  assert.equal({}.unexpected, undefined);
});

test("the deepmerge patch preserves normal Expo config merge behavior", () => {
  const symbol = Symbol("metadata");
  const result = merge(
    { nested: { first: true }, plugins: ["one"], [symbol]: "metadata" },
    { nested: { second: true }, plugins: ["two"] },
  );

  assert.deepEqual(result.nested, { first: true, second: true });
  assert.deepEqual(result.plugins, ["one", "two"]);
  assert.equal(result[symbol], "metadata");
  assert.deepEqual(
    merge({ plugins: ["one"] }, { plugins: ["two"] }, {
      arrayMerge: (_target, source) => source,
    }),
    { plugins: ["two"] },
  );
});
