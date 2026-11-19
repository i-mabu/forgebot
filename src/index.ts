// ===============
// 1. 起動エントリ
// ===============

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachHandlers, createClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { CooldownTracker } from "./cooldown.js";
import { DraftStore } from "./draft.js";
import { createDefaultRegistry, loadPluginsFromDir } from "./plugins.js";
import { Store } from "./store.js";
import { attachReadyWatchdog } from "./watchdog.js";

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
  // Gateway安全構造: READY が来ないサイレント停滞を検知して終了する (watchdog.ts)
  attachReadyWatchdog(client);
  const here = dirname(fileURLToPath(import.meta.url));
  const registry = createDefaultRegistry();
  for (const pluginsDir of [
    join(here, "..", "plugins"),
    join(here, "..", "..", "plugins"),
  ]) {
    const { result: pluginLoad } = await loadPluginsFromDir(
      pluginsDir,
      registry,
    );
    for (const name of pluginLoad.loaded) {
      console.log(`Plugin loaded: ${name}`);
    }
    for (const error of pluginLoad.errors) {
      console.warn(`Plugin load failed: ${error.name}: ${error.message}`);
    }
    if (pluginLoad.loaded.length > 0) break;
  }
  const handlers = attachHandlers(client, {
    store,
    cooldowns: new CooldownTracker(),
    drafts: new DraftStore(),
    globalDisabled: config.disabled,
    plugins: registry,
  });

  // ================
  // 3. 終了処理の登録
  // ================

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutdown: ${signal}`);
    handlers.stop();
    client.destroy();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(config.token);
}

await main();
