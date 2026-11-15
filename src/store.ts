// ======================
// 1. SQLite ストアの基盤
// ======================

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Blueprint } from "./blueprint.js";

export type VariableScope = "guild" | "user" | "global";

export interface GuildCounts {
  blueprints: number;
  variables: number;
  counters: number;
  executions: number;
}

export interface GuildExport {
  guildId: string;
  disabled: boolean;
  executions: number;
  blueprints: Blueprint[];
  variables: Array<{
    scope: VariableScope;
    ownerId: string;
    key: string;
    value: string;
  }>;
  counters: Array<{ key: string; value: number }>;
}

interface BlueprintRow {
  definition: string;
}

interface VariableRow {
  scope: VariableScope;
  owner_id: string;
  key: string;
  value: string;
}

interface CounterRow {
  key: string;
  value: number;
}

interface CountRow {
  n: number;
}

// ===============
// 2. スキーマ定義
// ===============

const SCHEMA = `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0,
  execution_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blueprints (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, name)
);
CREATE TABLE IF NOT EXISTS variables (
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, scope, owner_id, key)
);
CREATE TABLE IF NOT EXISTS counters (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, key)
);
`;

// ===============
// 3. Store クラス
// ===============

export class Store {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ================
  // 4. ギルドの管理
  // ================

  ensureGuild(guildId: string): void {
    const at = this.now();
    this.prepare(
      "INSERT OR IGNORE INTO guilds (guild_id, created_at, updated_at) VALUES (?, ?, ?)",
    ).run(guildId, at, at);
  }

  setGuildDisabled(guildId: string, disabled: boolean): void {
    this.ensureGuild(guildId);
    this.prepare(
      "UPDATE guilds SET disabled = ?, updated_at = ? WHERE guild_id = ?",
    ).run(disabled ? 1 : 0, this.now(), guildId);
  }

  isGuildDisabled(guildId: string): boolean {
    const row = this.prepare(
      "SELECT disabled AS n FROM guilds WHERE guild_id = ?",
    ).get(guildId) as CountRow | undefined;
    return row !== undefined && row.n === 1;
  }

  recordExecution(guildId: string): void {
    this.ensureGuild(guildId);
    this.prepare(
      "UPDATE guilds SET execution_count = execution_count + 1, updated_at = ? WHERE guild_id = ?",
    ).run(this.now(), guildId);
  }

  // ====================
  // 5. Blueprint の保存
  // ====================

  upsertBlueprint(guildId: string, blueprint: Blueprint): void {
    this.ensureGuild(guildId);
    const at = this.now();
    this.prepare(
      `INSERT INTO blueprints (guild_id, name, definition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, name)
       DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at`,
    ).run(guildId, blueprint.name, JSON.stringify(blueprint), at, at);
  }

  getBlueprint(guildId: string, name: string): Blueprint | null {
    const row = this.prepare(
      "SELECT definition FROM blueprints WHERE guild_id = ? AND name = ?",
    ).get(guildId, name) as BlueprintRow | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.definition) as Blueprint;
  }

  listBlueprints(guildId: string): Blueprint[] {
    const rows = this.prepare(
      "SELECT definition FROM blueprints WHERE guild_id = ? ORDER BY name",
    ).all(guildId) as unknown as BlueprintRow[];
    return rows.map((row) => JSON.parse(row.definition) as Blueprint);
  }

  deleteBlueprint(guildId: string, name: string): boolean {
    const result = this.prepare(
      "DELETE FROM blueprints WHERE guild_id = ? AND name = ?",
    ).run(guildId, name);
    return result.changes > 0;
  }

  // ============
  // 6. 変数の保存
  // ============

  setVariable(
    guildId: string,
    scope: VariableScope,
    ownerId: string,
    key: string,
    value: string,
  ): void {
    this.ensureGuild(guildId);
    this.prepare(
      `INSERT INTO variables (guild_id, scope, owner_id, key, value)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, scope, owner_id, key)
       DO UPDATE SET value = excluded.value`,
    ).run(guildId, scope, ownerId, key, value);
  }

  getVariable(
    guildId: string,
    scope: VariableScope,
    ownerId: string,
    key: string,
  ): string | null {
    const row = this.prepare(
      "SELECT value FROM variables WHERE guild_id = ? AND scope = ? AND owner_id = ? AND key = ?",
    ).get(guildId, scope, ownerId, key) as { value: string } | undefined;
    return row === undefined ? null : row.value;
  }

  // ==================
  // 7. カウンターの保存
  // ==================

  incrementCounter(guildId: string, key: string, amount = 1): number {
    this.ensureGuild(guildId);
    this.prepare(
      `INSERT INTO counters (guild_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, key)
       DO UPDATE SET value = value + excluded.value`,
    ).run(guildId, key, amount);
    return this.getCounter(guildId, key);
  }

  getCounter(guildId: string, key: string): number {
    const row = this.prepare(
      "SELECT value FROM counters WHERE guild_id = ? AND key = ?",
    ).get(guildId, key) as { value: number } | undefined;
    return row === undefined ? 0 : row.value;
  }

  // =====================
  // 8. 集計と書き出しと削除
  // =====================

  getCounts(guildId: string): GuildCounts {
    const count = (sql: string): number => {
      const row = this.prepare(sql).get(guildId) as CountRow | undefined;
      return row === undefined ? 0 : row.n;
    };
    return {
      blueprints: count(
        "SELECT COUNT(*) AS n FROM blueprints WHERE guild_id = ?",
      ),
      variables: count(
        "SELECT COUNT(*) AS n FROM variables WHERE guild_id = ?",
      ),
      counters: count("SELECT COUNT(*) AS n FROM counters WHERE guild_id = ?"),
      executions: count(
        "SELECT execution_count AS n FROM guilds WHERE guild_id = ?",
      ),
    };
  }

  exportGuildData(guildId: string): GuildExport {
    const counts = this.getCounts(guildId);
    const variableRows = this.prepare(
      "SELECT scope, owner_id, key, value FROM variables WHERE guild_id = ? ORDER BY scope, owner_id, key",
    ).all(guildId) as unknown as VariableRow[];
    const counterRows = this.prepare(
      "SELECT key, value FROM counters WHERE guild_id = ? ORDER BY key",
    ).all(guildId) as unknown as CounterRow[];
    return {
      guildId,
      disabled: this.isGuildDisabled(guildId),
      executions: counts.executions,
      blueprints: this.listBlueprints(guildId),
      variables: variableRows.map((row) => ({
        scope: row.scope,
        ownerId: row.owner_id,
        key: row.key,
        value: row.value,
      })),
      counters: counterRows.map((row) => ({
        key: row.key,
        value: row.value,
      })),
    };
  }

  deleteGuildData(guildId: string): void {
    this.db.exec("BEGIN");
    try {
      this.prepare("DELETE FROM blueprints WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM variables WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM counters WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM guilds WHERE guild_id = ?").run(guildId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ==========
  // 9. 終了処理
  // ==========

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
