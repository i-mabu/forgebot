// ======================
// 1. SQLite ストアの基盤
// ======================

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Blueprint } from "./blueprint.js";
import type { GrowthRecord } from "./growth.js";
import type { MemoryRecord, MemoryStatus } from "./memory.js";

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
  memories: MemoryRecord[];
  growth: GrowthRecord | null;
  pluginInstalls: Array<{ pluginName: string; enabled: boolean }>;
}

export interface PluginInstall {
  guildId: string;
  pluginName: string;
  enabled: boolean;
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

interface AutomationStateRow {
  last_run_at: string;
}

interface ScheduledBlueprintRow {
  guild_id: string;
  definition: string;
}

interface MemoryRow {
  guild_id: string;
  key: string;
  kind: string;
  content: string;
  status: MemoryStatus;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

interface GrowthRow {
  guild_id: string;
  total_executions: number;
  active_days: number;
  last_active_date: string | null;
  first_active_at: string | null;
}

interface PluginInstallRow {
  plugin_name: string;
  enabled: number;
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
CREATE TABLE IF NOT EXISTS automation_fired (
  guild_id TEXT NOT NULL,
  blueprint_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, blueprint_name, message_id)
);
CREATE TABLE IF NOT EXISTS automation_state (
  guild_id TEXT NOT NULL,
  blueprint_name TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, blueprint_name)
);
CREATE TABLE IF NOT EXISTS memories (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS growth (
  guild_id TEXT PRIMARY KEY,
  total_executions INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  first_active_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_installs (
  guild_id TEXT NOT NULL,
  plugin_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, plugin_name)
);
`;

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    guildId: row.guild_id,
    key: row.key,
    kind: row.kind,
    content: row.content,
    status: row.status,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

  // SQL 文字列ごとにコンパイル済みステートメントをキャッシュして再利用する。
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
    const at = this.now();
    this.prepare(
      "UPDATE guilds SET execution_count = execution_count + 1, updated_at = ? WHERE guild_id = ?",
    ).run(at, guildId);
    this.recordGrowthExecution(guildId, new Date(at));
  }

  // ==================
  // 11. 記憶の保存
  // ==================

  proposeMemory(
    guildId: string,
    input: {
      key: string;
      kind: string;
      content: string;
      createdBy: string;
    },
  ): MemoryRecord {
    this.ensureGuild(guildId);
    const at = this.now();
    this.prepare(
      `INSERT INTO memories (guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?)
       ON CONFLICT (guild_id, key)
       DO UPDATE SET kind = excluded.kind, content = excluded.content, status = 'pending', created_by = excluded.created_by, approved_by = NULL, updated_at = excluded.updated_at`,
    ).run(
      guildId,
      input.key,
      input.kind,
      input.content,
      input.createdBy,
      at,
      at,
    );
    return this.getMemory(guildId, input.key)!;
  }

  getMemory(guildId: string, key: string): MemoryRecord | null {
    const row = this.prepare(
      "SELECT guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at FROM memories WHERE guild_id = ? AND key = ?",
    ).get(guildId, key) as MemoryRow | undefined;
    return row === undefined ? null : rowToMemory(row);
  }

  getApprovedMemory(guildId: string, key: string): string | null {
    const row = this.prepare(
      "SELECT content FROM memories WHERE guild_id = ? AND key = ? AND status = 'approved'",
    ).get(guildId, key) as { content: string } | undefined;
    return row === undefined ? null : row.content;
  }

  listMemories(guildId: string, status?: MemoryStatus): MemoryRecord[] {
    const rows =
      status === undefined
        ? (this.prepare(
            "SELECT guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at FROM memories WHERE guild_id = ? ORDER BY key",
          ).all(guildId) as unknown as MemoryRow[])
        : (this.prepare(
            "SELECT guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at FROM memories WHERE guild_id = ? AND status = ? ORDER BY key",
          ).all(guildId, status) as unknown as MemoryRow[]);
    return rows.map(rowToMemory);
  }

  approveMemory(guildId: string, key: string, approvedBy: string): boolean {
    const result = this.prepare(
      "UPDATE memories SET status = 'approved', approved_by = ?, updated_at = ? WHERE guild_id = ? AND key = ?",
    ).run(approvedBy, this.now(), guildId, key);
    return result.changes > 0;
  }

  rejectMemory(guildId: string, key: string): boolean {
    const result = this.prepare(
      "UPDATE memories SET status = 'rejected', approved_by = NULL, updated_at = ? WHERE guild_id = ? AND key = ?",
    ).run(this.now(), guildId, key);
    return result.changes > 0;
  }

  deleteMemory(guildId: string, key: string): boolean {
    const result = this.prepare(
      "DELETE FROM memories WHERE guild_id = ? AND key = ?",
    ).run(guildId, key);
    return result.changes > 0;
  }

  countMemories(guildId: string, status?: MemoryStatus): number {
    const row =
      status === undefined
        ? (this.prepare(
            "SELECT COUNT(*) AS n FROM memories WHERE guild_id = ?",
          ).get(guildId) as CountRow | undefined)
        : (this.prepare(
            "SELECT COUNT(*) AS n FROM memories WHERE guild_id = ? AND status = ?",
          ).get(guildId, status) as CountRow | undefined);
    return row === undefined ? 0 : row.n;
  }

  // ==================
  // 12. 成長の保存
  // ==================

  recordGrowthExecution(guildId: string, at: Date = new Date()): GrowthRecord {
    this.ensureGuild(guildId);
    const iso = at.toISOString();
    const today = iso.slice(0, 10);
    const existing = this.getGrowthRecord(guildId);
    if (existing === null) {
      this.prepare(
        "INSERT INTO growth (guild_id, total_executions, active_days, last_active_date, first_active_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)",
      ).run(guildId, today, iso, iso);
    } else {
      const isNewDay = existing.lastActiveDate !== today;
      this.prepare(
        "UPDATE growth SET total_executions = total_executions + 1, active_days = active_days + ?, last_active_date = ?, updated_at = ? WHERE guild_id = ?",
      ).run(isNewDay ? 1 : 0, today, iso, guildId);
    }
    return this.getGrowthRecord(guildId)!;
  }

  getGrowthRecord(guildId: string): GrowthRecord | null {
    const row = this.prepare(
      "SELECT guild_id, total_executions, active_days, last_active_date, first_active_at FROM growth WHERE guild_id = ?",
    ).get(guildId) as GrowthRow | undefined;
    if (row === undefined) return null;
    return {
      guildId: row.guild_id,
      totalExecutions: row.total_executions,
      activeDays: row.active_days,
      lastActiveDate: row.last_active_date,
      firstActiveAt: row.first_active_at,
    };
  }

  // =======================
  // 13. プラグイン有効化の保存
  // =======================

  setPluginEnabled(
    guildId: string,
    pluginName: string,
    enabled: boolean,
  ): void {
    this.ensureGuild(guildId);
    const at = this.now();
    this.prepare(
      `INSERT INTO plugin_installs (guild_id, plugin_name, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, plugin_name)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    ).run(guildId, pluginName, enabled ? 1 : 0, at, at);
  }

  isPluginEnabled(guildId: string, pluginName: string): boolean {
    const row = this.prepare(
      "SELECT enabled FROM plugin_installs WHERE guild_id = ? AND plugin_name = ?",
    ).get(guildId, pluginName) as { enabled: number } | undefined;
    return row !== undefined && row.enabled === 1;
  }

  listPluginInstalls(guildId: string): PluginInstall[] {
    const rows = this.prepare(
      "SELECT plugin_name, enabled FROM plugin_installs WHERE guild_id = ? ORDER BY plugin_name",
    ).all(guildId) as unknown as PluginInstallRow[];
    return rows.map((row) => ({
      guildId,
      pluginName: row.plugin_name,
      enabled: row.enabled === 1,
    }));
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

  replaceBlueprint(
    guildId: string,
    originalName: string,
    blueprint: Blueprint,
  ): boolean {
    this.db.exec("BEGIN");
    try {
      const existing = this.getBlueprint(guildId, originalName);
      if (existing === null) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (originalName !== blueprint.name) {
        this.deleteBlueprint(guildId, originalName);
      }
      this.upsertBlueprint(guildId, blueprint);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  // ===================
  // 8. 自動化の状態管理
  // ===================

  hasAutomationFired(
    guildId: string,
    blueprintName: string,
    messageId: string,
  ): boolean {
    const row = this.prepare(
      "SELECT 1 AS n FROM automation_fired WHERE guild_id = ? AND blueprint_name = ? AND message_id = ?",
    ).get(guildId, blueprintName, messageId) as CountRow | undefined;
    return row !== undefined;
  }

  // 記録できた場合だけ true を返す。既に発火済みなら false。
  markAutomationFired(
    guildId: string,
    blueprintName: string,
    messageId: string,
  ): boolean {
    this.ensureGuild(guildId);
    const result = this.prepare(
      "INSERT OR IGNORE INTO automation_fired (guild_id, blueprint_name, message_id, fired_at) VALUES (?, ?, ?, ?)",
    ).run(guildId, blueprintName, messageId, this.now());
    return result.changes > 0;
  }

  getAutomationLastRun(guildId: string, blueprintName: string): Date | null {
    const row = this.prepare(
      "SELECT last_run_at FROM automation_state WHERE guild_id = ? AND blueprint_name = ?",
    ).get(guildId, blueprintName) as AutomationStateRow | undefined;
    return row === undefined ? null : new Date(row.last_run_at);
  }

  setAutomationLastRun(guildId: string, blueprintName: string, at: Date): void {
    this.ensureGuild(guildId);
    this.prepare(
      `INSERT INTO automation_state (guild_id, blueprint_name, last_run_at)
       VALUES (?, ?, ?)
       ON CONFLICT (guild_id, blueprint_name)
       DO UPDATE SET last_run_at = excluded.last_run_at`,
    ).run(guildId, blueprintName, at.toISOString());
  }

  listBlueprintsByTriggerType(
    guildId: string,
    triggerType: string,
  ): Blueprint[] {
    const rows = this.prepare(
      "SELECT definition FROM blueprints WHERE guild_id = ? AND json_extract(definition, '$.trigger.type') = ? ORDER BY name",
    ).all(guildId, triggerType) as unknown as BlueprintRow[];
    return rows.map((row) => JSON.parse(row.definition) as Blueprint);
  }

  listScheduledBlueprints(): Array<{ guildId: string; blueprint: Blueprint }> {
    const rows = this.prepare(
      "SELECT guild_id, definition FROM blueprints WHERE json_extract(definition, '$.trigger.type') = 'schedule' ORDER BY guild_id, name",
    ).all() as unknown as ScheduledBlueprintRow[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      blueprint: JSON.parse(row.definition) as Blueprint,
    }));
  }

  // =====================
  // 9. 集計と書き出しと削除
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
      memories: this.listMemories(guildId),
      growth: this.getGrowthRecord(guildId),
      pluginInstalls: this.listPluginInstalls(guildId).map((row) => ({
        pluginName: row.pluginName,
        enabled: row.enabled,
      })),
    };
  }

  deleteGuildData(guildId: string): void {
    this.db.exec("BEGIN");
    try {
      this.prepare("DELETE FROM blueprints WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM variables WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM counters WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM automation_fired WHERE guild_id = ?").run(
        guildId,
      );
      this.prepare("DELETE FROM automation_state WHERE guild_id = ?").run(
        guildId,
      );
      this.prepare("DELETE FROM memories WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM growth WHERE guild_id = ?").run(guildId);
      this.prepare("DELETE FROM plugin_installs WHERE guild_id = ?").run(
        guildId,
      );
      this.prepare("DELETE FROM guilds WHERE guild_id = ?").run(guildId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ===========
  // 10. 終了処理
  // ===========

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
