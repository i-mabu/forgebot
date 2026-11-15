// ===============
// 1. 起動エントリ
// ===============

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { attachHandlers, createClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { CooldownTracker } from "./cooldown.js";
import { DraftStore } from "./draft.js";
import { Store } from "./store.js";

// ===========
// 2. 起動処理
// ===========

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  if (config.dbPath !== ":memory:") {
    mkdirSync(dirname(config.dbPath), { recursive: true });
  }
  const store = new Store(config.dbPath);
  const client = createClient();
  attachHandlers(client, {
    store,
    cooldowns: new CooldownTracker(),
    drafts: new DraftStore(),
    globalDisabled: config.disabled,
  });

  // ================
  // 3. 終了処理の登録
  // ================

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutdown: ${signal}`);
    client.destroy();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(config.token);
}

await main();
