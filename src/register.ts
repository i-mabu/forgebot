// =====================
// 1. コマンド登録の基盤
// =====================

import { REST, Routes } from "discord.js";
import { buildCommands } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";

// =============
// 2. 登録の実行
// =============

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
  if (config.guildId === null) {
    console.error(
      "Configuration error: Missing required environment variable(s): DISCORD_GUILD_ID",
    );
    process.exit(1);
  }
  const body = buildCommands();
  const rest = new REST().setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body },
  );
  console.log(`Registered: ${body.length} commands`);
}

await main();
