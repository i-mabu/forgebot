// ===================
// 1. 実行エンジンの型
// ===================

import type { Action, Blueprint, Condition } from "./blueprint.js";
import { CooldownTracker, cooldownKey } from "./cooldown.js";
import { renderTemplate } from "./render.js";
import type { Store } from "./store.js";

export type IntendedAction =
  | { type: "reply"; text: string }
  | {
      type: "incrementCounter";
      key: string;
      amount: number;
      newValue: number;
    }
  | { type: "setVariable"; key: string; value: string };

export type EngineStatus = "ok" | "blocked" | "skipped";

export interface EngineResult {
  status: EngineStatus;
  reason?: string;
  remainingMs?: number;
  outputs: string[];
  actions: IntendedAction[];
}

export interface EngineContext {
  guildId: string;
  userId: string;
  userName: string;
  serverName: string;
}

export interface EngineDeps {
  store: Store;
  cooldowns: CooldownTracker;
  globalDisabled: boolean;
  rng?: () => number;
}

// =============
// 2. 条件の評価
// =============

export function evaluateCondition(
  condition: Condition,
  deps: EngineDeps,
  ctx: EngineContext,
): boolean {
  if (condition.type === "always") return true;
  if (condition.type === "chance") {
    const rng = deps.rng ?? Math.random;
    return rng() * 100 < condition.percent;
  }
  const userValue = deps.store.getVariable(
    ctx.guildId,
    "user",
    ctx.userId,
    condition.key,
  );
  const guildValue = deps.store.getVariable(
    ctx.guildId,
    "guild",
    "",
    condition.key,
  );
  return (userValue ?? guildValue) === condition.value;
}

// =================
// 3. アクション実行
// =================

function executeAction(
  action: Action,
  blueprint: Blueprint,
  deps: EngineDeps,
  ctx: EngineContext,
  outputs: string[],
  intended: IntendedAction[],
): void {
  if (action.type === "reply") {
    const text = renderTemplate(action.template, {
      user: ctx.userName,
      server: ctx.serverName,
      getCounter: (key) => deps.store.getCounter(ctx.guildId, key),
      getVariable: (key) =>
        deps.store.getVariable(ctx.guildId, "user", ctx.userId, key) ??
        deps.store.getVariable(ctx.guildId, "guild", "", key),
      rng: deps.rng,
    });
    const rendered = (blueprint.presentation?.prefix ?? "") + text;
    outputs.push(rendered);
    intended.push({ type: "reply", text: rendered });
    return;
  }
  if (action.type === "incrementCounter") {
    const amount = action.amount ?? 1;
    const newValue = deps.store.incrementCounter(
      ctx.guildId,
      action.key,
      amount,
    );
    intended.push({
      type: "incrementCounter",
      key: action.key,
      amount,
      newValue,
    });
    return;
  }
  deps.store.setVariable(
    ctx.guildId,
    "user",
    ctx.userId,
    action.key,
    action.value,
  );
  intended.push({
    type: "setVariable",
    key: action.key,
    value: action.value,
  });
}

// ===================
// 4. Blueprint の実行
// ===================

export function executeBlueprint(
  blueprint: Blueprint,
  deps: EngineDeps,
  ctx: EngineContext,
): EngineResult {
  if (deps.globalDisabled) {
    return {
      status: "blocked",
      reason: "global_disabled",
      outputs: [],
      actions: [],
    };
  }
  if (deps.store.isGuildDisabled(ctx.guildId)) {
    return {
      status: "blocked",
      reason: "guild_disabled",
      outputs: [],
      actions: [],
    };
  }
  const cooldownSeconds = blueprint.cooldownSeconds ?? 0;
  const key = cooldownKey(ctx.guildId, blueprint.name, ctx.userId);
  const check = deps.cooldowns.check(key, cooldownSeconds);
  if (!check.allowed) {
    return {
      status: "blocked",
      reason: "cooldown",
      remainingMs: check.remainingMs,
      outputs: [],
      actions: [],
    };
  }
  for (const condition of blueprint.conditions) {
    if (!evaluateCondition(condition, deps, ctx)) {
      return {
        status: "skipped",
        reason: "condition",
        outputs: [],
        actions: [],
      };
    }
  }
  const outputs: string[] = [];
  const intended: IntendedAction[] = [];
  for (const action of blueprint.actions) {
    executeAction(action, blueprint, deps, ctx, outputs, intended);
  }
  if (cooldownSeconds > 0) deps.cooldowns.record(key);
  deps.store.recordExecution(ctx.guildId);
  return { status: "ok", outputs, actions: intended };
}
