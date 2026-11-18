// =====================
// 1. Blueprint の型定義
// =====================

export type ReactionTrigger = {
  type: "reaction";
  emoji?: string;
  threshold: number;
  channelId: string;
  template: string;
};

export type ScheduleTrigger = {
  type: "schedule";
  intervalMinutes?: number;
  dailyTime?: string;
  timezone: string;
  channelId: string;
  template: string;
};

export type Trigger =
  | { type: "slash"; command: string }
  | { type: "event"; event: string }
  | ReactionTrigger
  | ScheduleTrigger;

export type Condition =
  | { type: "always" }
  | { type: "variableEquals"; key: string; value: string }
  | { type: "chance"; percent: number };

export type Action =
  | { type: "reply"; template: string }
  | { type: "sendToChannel"; channelId: string; template: string }
  | { type: "incrementCounter"; key: string; amount?: number }
  | { type: "setVariable"; key: string; value: string };

export interface Presentation {
  format?: "text" | "embed";
  color?: number;
  prefix?: string;
}

export interface Blueprint {
  name: string;
  description?: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  presentation?: Presentation;
  cooldownSeconds?: number;
}

// ===================
// 2. 上限と検証用定数
// ===================

export const MAX_ACTIONS = 10;
export const MAX_CONDITIONS = 10;
export const MAX_BLUEPRINT_NAME_LENGTH = 32;
export const MAX_REACTION_THRESHOLD = 1000;
export const MAX_SCHEDULE_INTERVAL_MINUTES = 43200;
// インポート経路の検証もフォーム経路 (blueprintForm) と同じ上限に揃える。
export const MAX_COOLDOWN_SECONDS = 86400;
export const MAX_COUNTER_AMOUNT = 1000;
export const GRAPHITE = 0x3a3f4a;

const CONDITION_TYPES = new Set(["always", "variableEquals", "chance"]);
const ACTION_TYPES = new Set([
  "reply",
  "sendToChannel",
  "incrementCounter",
  "setVariable",
]);
const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// =============
// 3. 検証エラー
// =============

export class BlueprintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintValidationError";
  }
}

function fail(message: string): never {
  throw new BlueprintValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireKey(value: unknown, field: string, block: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${block} block requires a non-empty "${field}"`);
  }
  return value;
}

// =================
// 4. ブロックの検証
// =================

function validateTrigger(raw: unknown): Trigger {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    fail("Blueprint trigger must be an object with a type");
  }
  if (raw.type === "slash") {
    const command = requireKey(raw.command, "command", "slash trigger");
    return { type: "slash", command };
  }
  if (raw.type === "event") {
    // event Trigger（メンバー参加など）は未実装で、保存しても
    // どこでも実行されない。無言で無効な Blueprint が出来てしまう
    // ため、検証の時点で弾く。
    fail("event trigger is not supported yet");
  }
  if (raw.type === "reaction") {
    const threshold = raw.threshold;
    if (
      typeof threshold !== "number" ||
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > MAX_REACTION_THRESHOLD
    ) {
      fail(
        `reaction trigger requires an integer threshold between 1 and ${MAX_REACTION_THRESHOLD}`,
      );
    }
    const channelId = requireKey(
      raw.channelId,
      "channelId",
      "reaction trigger",
    );
    const template = requireKey(raw.template, "template", "reaction trigger");
    const trigger: ReactionTrigger = {
      type: "reaction",
      threshold,
      channelId,
      template,
    };
    if (raw.emoji !== undefined) {
      const emoji = requireKey(raw.emoji, "emoji", "reaction trigger");
      trigger.emoji = emoji;
    }
    return trigger;
  }
  if (raw.type === "schedule") {
    const channelId = requireKey(
      raw.channelId,
      "channelId",
      "schedule trigger",
    );
    const template = requireKey(raw.template, "template", "schedule trigger");
    const timezone = requireKey(raw.timezone, "timezone", "schedule trigger");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      fail(`schedule trigger requires a valid timezone: ${timezone}`);
    }
    const hasDaily = raw.dailyTime !== undefined;
    const hasInterval = raw.intervalMinutes !== undefined;
    if (hasDaily === hasInterval) {
      fail(
        "schedule trigger requires exactly one of dailyTime or intervalMinutes",
      );
    }
    const trigger: ScheduleTrigger = {
      type: "schedule",
      timezone,
      channelId,
      template,
    };
    if (hasDaily) {
      if (
        typeof raw.dailyTime !== "string" ||
        !DAILY_TIME_PATTERN.test(raw.dailyTime)
      ) {
        fail('schedule trigger dailyTime must be in "HH:MM" format');
      }
      trigger.dailyTime = raw.dailyTime;
    }
    if (hasInterval) {
      const interval = raw.intervalMinutes;
      if (
        typeof interval !== "number" ||
        !Number.isInteger(interval) ||
        interval < 1 ||
        interval > MAX_SCHEDULE_INTERVAL_MINUTES
      ) {
        fail(
          `schedule trigger requires an integer intervalMinutes between 1 and ${MAX_SCHEDULE_INTERVAL_MINUTES}`,
        );
      }
      trigger.intervalMinutes = interval;
    }
    return trigger;
  }
  fail(`Unknown trigger type: ${String(raw.type)}`);
}

function validateCondition(raw: unknown, index: number): Condition {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    fail(`Condition #${index + 1} must be an object with a type`);
  }
  if (!CONDITION_TYPES.has(raw.type)) {
    fail(`Unknown condition type: ${raw.type}`);
  }
  if (raw.type === "always") return { type: "always" };
  if (raw.type === "variableEquals") {
    const key = requireKey(raw.key, "key", "variableEquals condition");
    if (typeof raw.value !== "string") {
      fail('variableEquals condition requires a string "value"');
    }
    return { type: "variableEquals", key, value: raw.value };
  }
  const percent = raw.percent;
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    fail("chance condition requires a percent between 0 and 100");
  }
  return { type: "chance", percent };
}

function validateAction(raw: unknown, index: number): Action {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    fail(`Action #${index + 1} must be an object with a type`);
  }
  if (!ACTION_TYPES.has(raw.type)) {
    fail(`Unknown action type: ${raw.type}`);
  }
  if (raw.type === "reply") {
    const template = requireKey(raw.template, "template", "reply action");
    return { type: "reply", template };
  }
  if (raw.type === "sendToChannel") {
    const channelId = requireKey(
      raw.channelId,
      "channelId",
      "sendToChannel action",
    );
    const template = requireKey(
      raw.template,
      "template",
      "sendToChannel action",
    );
    return { type: "sendToChannel", channelId, template };
  }
  if (raw.type === "incrementCounter") {
    const key = requireKey(raw.key, "key", "incrementCounter action");
    const amount = raw.amount ?? 1;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount === 0 ||
      amount < -MAX_COUNTER_AMOUNT ||
      amount > MAX_COUNTER_AMOUNT
    ) {
      fail(
        `incrementCounter action requires an integer amount between -${MAX_COUNTER_AMOUNT} and ${MAX_COUNTER_AMOUNT} (excluding 0)`,
      );
    }
    return { type: "incrementCounter", key, amount };
  }
  const key = requireKey(raw.key, "key", "setVariable action");
  if (typeof raw.value !== "string") {
    fail('setVariable action requires a string "value"');
  }
  return { type: "setVariable", key, value: raw.value };
}

function validatePresentation(raw: unknown): Presentation | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) fail("Blueprint presentation must be an object");
  const presentation: Presentation = {};
  if (raw.format !== undefined) {
    if (raw.format !== "text" && raw.format !== "embed") {
      fail('presentation format must be "text" or "embed"');
    }
    presentation.format = raw.format;
  }
  if (raw.color !== undefined) {
    if (
      typeof raw.color !== "number" ||
      !Number.isInteger(raw.color) ||
      raw.color < 0 ||
      raw.color > 0xffffff
    ) {
      fail("presentation color must be an integer between 0 and 16777215");
    }
    presentation.color = raw.color;
  }
  if (raw.prefix !== undefined) {
    if (typeof raw.prefix !== "string") {
      fail("presentation prefix must be a string");
    }
    presentation.prefix = raw.prefix;
  }
  return presentation;
}

// ===================
// 5. Blueprint の検証
// ===================

export function validateBlueprint(input: unknown): Blueprint {
  if (!isRecord(input)) fail("Blueprint must be an object");
  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") {
    fail("Blueprint name is required");
  }
  if (name.length > MAX_BLUEPRINT_NAME_LENGTH) {
    fail(
      `Blueprint name is too long: ${name.length} characters (max ${MAX_BLUEPRINT_NAME_LENGTH})`,
    );
  }
  if (/\s/.test(name)) {
    fail("Blueprint name must not contain whitespace");
  }
  const trigger = validateTrigger(input.trigger);
  const rawConditions = input.conditions ?? [];
  if (!Array.isArray(rawConditions)) {
    fail("Blueprint conditions must be an array");
  }
  if (rawConditions.length > MAX_CONDITIONS) {
    fail(
      `Blueprint has too many conditions: ${rawConditions.length} (max ${MAX_CONDITIONS})`,
    );
  }
  const conditions = rawConditions.map((c, i) => validateCondition(c, i));
  const rawActions = input.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    fail("Blueprint requires at least one action");
  }
  if (rawActions.length > MAX_ACTIONS) {
    fail(
      `Blueprint has too many actions: ${rawActions.length} (max ${MAX_ACTIONS})`,
    );
  }
  const actions = rawActions.map((a, i) => validateAction(a, i));
  const blueprint: Blueprint = { name, trigger, conditions, actions };
  if (input.description !== undefined) {
    if (typeof input.description !== "string") {
      fail("Blueprint description must be a string");
    }
    blueprint.description = input.description;
  }
  const presentation = validatePresentation(input.presentation);
  if (presentation !== undefined) blueprint.presentation = presentation;
  if (input.cooldownSeconds !== undefined) {
    const cooldown = input.cooldownSeconds;
    if (
      typeof cooldown !== "number" ||
      !Number.isInteger(cooldown) ||
      cooldown < 0 ||
      cooldown > MAX_COOLDOWN_SECONDS
    ) {
      fail(
        `Blueprint cooldownSeconds must be an integer between 0 and ${MAX_COOLDOWN_SECONDS}`,
      );
    }
    blueprint.cooldownSeconds = cooldown;
  }
  return blueprint;
}
