import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

test("必須変数が不足したら変数名を挙げてエラーになる", () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.message.includes("DISCORD_TOKEN") &&
      error.message.includes("DISCORD_CLIENT_ID"),
  );
});

test("必須変数が揃えば設定を返す", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "123",
  });
  assert.equal(config.token, "token");
  assert.equal(config.clientId, "123");
  assert.equal(config.disabled, false);
  assert.equal(config.dbPath, "data/forge.sqlite");
  assert.equal(config.guildId, null);
});

test("FORGE_DISABLED を真偽値として解釈する", () => {
  const base = { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "1" };
  assert.equal(loadConfig({ ...base, FORGE_DISABLED: "true" }).disabled, true);
  assert.equal(loadConfig({ ...base, FORGE_DISABLED: "1" }).disabled, true);
  assert.equal(loadConfig({ ...base, FORGE_DISABLED: "0" }).disabled, false);
});
