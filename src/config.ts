// =====================
// 1. 環境変数の読み込み
// =====================

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ForgeConfig {
  token: string;
  clientId: string;
  guildId: string | null;
  disabled: boolean;
  dbPath: string;
}

// =============
// 2. 値のパース
// =============

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

// =============
// 3. 設定の構築
// =============

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ForgeConfig {
  const missing: string[] = [];
  const token = env.DISCORD_TOKEN?.trim() ?? "";
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  if (token === "") missing.push("DISCORD_TOKEN");
  if (clientId === "") missing.push("DISCORD_CLIENT_ID");
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  const dbPath = env.FORGE_DB_PATH?.trim() ?? "";
  return {
    token,
    clientId,
    guildId: guildId === "" ? null : guildId,
    disabled: parseBoolean(env.FORGE_DISABLED),
    dbPath: dbPath === "" ? "data/forge.sqlite" : dbPath,
  };
}
