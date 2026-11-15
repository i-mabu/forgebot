// =====================
// 1. 保存結果の型と上限
// =====================

import type { Blueprint } from "./blueprint.js";
import type { Store } from "./store.js";

export const MAX_BLUEPRINTS_PER_GUILD = 100;

export type SaveBlueprintResult =
  | { ok: true }
  | {
      ok: false;
      reason: "duplicate" | "limit" | "not_found";
      message: string;
    };

// ===================
// 2. Blueprint の作成
// ===================

export function checkBlueprintCreation(
  store: Store,
  guildId: string,
  blueprint: Blueprint,
  limit: number = MAX_BLUEPRINTS_PER_GUILD,
): SaveBlueprintResult {
  if (store.getBlueprint(guildId, blueprint.name) !== null) {
    return {
      ok: false,
      reason: "duplicate",
      message: `作成できませんでした。同名の Blueprint が存在します: /${blueprint.name}`,
    };
  }
  if (store.getCounts(guildId).blueprints >= limit) {
    return {
      ok: false,
      reason: "limit",
      message: `作成できませんでした。Blueprintの上限（${limit}件）に達しています`,
    };
  }
  return { ok: true };
}

export function createBlueprint(
  store: Store,
  guildId: string,
  blueprint: Blueprint,
  limit: number = MAX_BLUEPRINTS_PER_GUILD,
): SaveBlueprintResult {
  const check = checkBlueprintCreation(store, guildId, blueprint, limit);
  if (!check.ok) return check;
  store.upsertBlueprint(guildId, blueprint);
  return { ok: true };
}

// ===================
// 3. Blueprint の置換
// ===================

// 編集の保存。名前の変更も含めて1回の置換として保存する。
export function checkBlueprintReplacement(
  store: Store,
  guildId: string,
  originalName: string,
  blueprint: Blueprint,
): SaveBlueprintResult {
  if (store.getBlueprint(guildId, originalName) === null) {
    return {
      ok: false,
      reason: "not_found",
      message: `見つかりませんでした: /${originalName}`,
    };
  }
  if (
    blueprint.name !== originalName &&
    store.getBlueprint(guildId, blueprint.name) !== null
  ) {
    return {
      ok: false,
      reason: "duplicate",
      message: `更新できませんでした。同名の Blueprint が存在します: /${blueprint.name}`,
    };
  }
  return { ok: true };
}

export function replaceBlueprint(
  store: Store,
  guildId: string,
  originalName: string,
  blueprint: Blueprint,
): SaveBlueprintResult {
  const check = checkBlueprintReplacement(
    store,
    guildId,
    originalName,
    blueprint,
  );
  if (!check.ok) return check;
  store.replaceBlueprint(guildId, originalName, blueprint);
  return { ok: true };
}
