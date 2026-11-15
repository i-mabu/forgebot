// ===========================
// 1. 自動化フォームの型と上限
// ===========================

import {
  BlueprintValidationError,
  MAX_REACTION_THRESHOLD,
  MAX_SCHEDULE_INTERVAL_MINUTES,
  validateBlueprint,
  type Blueprint,
} from "./blueprint.js";
import {
  MAX_TEMPLATE_LENGTH,
  validateCommandName,
  type FormResult,
} from "./blueprintForm.js";
import { isValidTimezone, parseDailyTime } from "./schedule.js";

export const MAX_EMOJI_LENGTH = 64;
export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export interface ReactionFormInput {
  name: string;
  emoji: string;
  threshold: string;
  channelId: string;
  template: string;
}

export interface ScheduleFormInput {
  name: string;
  dailyTime: string;
  intervalMinutes: string;
  channelId: string;
  template: string;
  timezone?: string;
}

export type AutomationForm =
  | { kind: "reaction"; input: ReactionFormInput }
  | { kind: "schedule"; input: ScheduleFormInput };

function ok<T>(value: T): FormResult<T> {
  return { ok: true, value };
}

function err<T>(message: string): FormResult<T> {
  return { ok: false, message };
}

function validateTemplate(raw: string): FormResult<string> {
  if (raw.trim() === "") return err("テンプレートが空です");
  if (raw.length > MAX_TEMPLATE_LENGTH) {
    return err(
      `テンプレートが長すぎます: ${raw.length} 文字 (上限 ${MAX_TEMPLATE_LENGTH} 文字)`,
    );
  }
  return ok(raw);
}

function validateChannelId(raw: string): FormResult<string> {
  if (raw.trim() === "") return err("送信先チャンネルが選択されていません");
  return ok(raw.trim());
}

function buildAutomation(raw: Record<string, unknown>): FormResult<Blueprint> {
  try {
    return ok(validateBlueprint(raw));
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      return err(`Blueprint を構築できませんでした: ${error.message}`);
    }
    throw error;
  }
}

// =========================
// 2. 閾値とタイミングの解釈
// =========================

export function parseThreshold(raw: string): FormResult<number> {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return err(
      `閾値は 1 から ${MAX_REACTION_THRESHOLD} の整数で入力してください`,
    );
  }
  const value = Number(trimmed);
  if (value < 1 || value > MAX_REACTION_THRESHOLD) {
    return err(
      `閾値は 1 から ${MAX_REACTION_THRESHOLD} の整数で入力してください`,
    );
  }
  return ok(value);
}

export function parseIntervalMinutes(raw: string): FormResult<number | null> {
  const trimmed = raw.trim();
  if (trimmed === "") return ok(null);
  if (!/^\d+$/.test(trimmed)) {
    return err(
      `間隔は 1 から ${MAX_SCHEDULE_INTERVAL_MINUTES} の整数 (分) で入力してください`,
    );
  }
  const value = Number(trimmed);
  if (value < 1 || value > MAX_SCHEDULE_INTERVAL_MINUTES) {
    return err(
      `間隔は 1 から ${MAX_SCHEDULE_INTERVAL_MINUTES} の整数 (分) で入力してください`,
    );
  }
  return ok(value);
}

// ===========================
// 3. リアクション自動化の構築
// ===========================

export function buildReactionBlueprint(
  input: ReactionFormInput,
): FormResult<Blueprint> {
  const name = validateCommandName(input.name);
  if (!name.ok) return name;
  const template = validateTemplate(input.template);
  if (!template.ok) return template;
  const channelId = validateChannelId(input.channelId);
  if (!channelId.ok) return channelId;
  const threshold = parseThreshold(input.threshold);
  if (!threshold.ok) return threshold;
  const emoji = input.emoji.trim();
  if ([...emoji].length > MAX_EMOJI_LENGTH) {
    return err(
      `絵文字が長すぎます: ${[...emoji].length} 文字 (上限 ${MAX_EMOJI_LENGTH} 文字)`,
    );
  }
  const trigger: Record<string, unknown> = {
    type: "reaction",
    threshold: threshold.value,
    channelId: channelId.value,
    template: template.value,
  };
  if (emoji !== "") trigger.emoji = emoji;
  return buildAutomation({
    name: name.value,
    trigger,
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: channelId.value,
        template: template.value,
      },
    ],
  });
}

// ===========================
// 4. スケジュール自動化の構築
// ===========================

export function buildScheduleBlueprint(
  input: ScheduleFormInput,
): FormResult<Blueprint> {
  const name = validateCommandName(input.name);
  if (!name.ok) return name;
  const template = validateTemplate(input.template);
  if (!template.ok) return template;
  const channelId = validateChannelId(input.channelId);
  if (!channelId.ok) return channelId;
  const dailyTime = input.dailyTime.trim();
  const interval = parseIntervalMinutes(input.intervalMinutes);
  if (!interval.ok) return interval;
  if (dailyTime !== "" && interval.value !== null) {
    return err("時刻と間隔はどちらか一方だけを入力してください");
  }
  if (dailyTime === "" && interval.value === null) {
    return err("時刻 (HH:MM) または間隔 (分) のどちらかを入力してください");
  }
  if (dailyTime !== "" && parseDailyTime(dailyTime) === null) {
    return err("時刻は HH:MM の形式で入力してください");
  }
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) {
    return err(`タイムゾーンが不正です: ${timezone}`);
  }
  const trigger: Record<string, unknown> = {
    type: "schedule",
    timezone,
    channelId: channelId.value,
    template: template.value,
  };
  if (dailyTime !== "") trigger.dailyTime = dailyTime;
  if (interval.value !== null) trigger.intervalMinutes = interval.value;
  return buildAutomation({
    name: name.value,
    trigger,
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: channelId.value,
        template: template.value,
      },
    ],
  });
}

// =======================
// 5. チャンネルの付け替え
// =======================

export function getAutomationChannelId(blueprint: Blueprint): string | null {
  if (
    blueprint.trigger.type === "reaction" ||
    blueprint.trigger.type === "schedule"
  ) {
    return blueprint.trigger.channelId;
  }
  return null;
}

// 共有コードの読み込み用。送信先チャンネルを読み込み先ギルドのものに差し替える。
export function remapAutomationChannel(
  blueprint: Blueprint,
  channelId: string,
): Blueprint {
  const copy = JSON.parse(JSON.stringify(blueprint)) as Blueprint;
  if (copy.trigger.type === "reaction" || copy.trigger.type === "schedule") {
    copy.trigger.channelId = channelId;
  }
  for (const action of copy.actions) {
    if (action.type === "sendToChannel") action.channelId = channelId;
  }
  return validateBlueprint(copy);
}

// ===================
// 6. フォームへの復元
// ===================

// 作成フォームで扱える単純な形の自動化 Blueprint だけを復元する。
export function extractAutomationForm(
  blueprint: Blueprint,
): FormResult<AutomationForm> {
  const trigger = blueprint.trigger;
  if (trigger.type !== "reaction" && trigger.type !== "schedule") {
    return err(
      "編集できませんでした。Trigger が自動化ではない Blueprint はこのフォームで編集できません",
    );
  }
  const conditions = blueprint.conditions;
  if (
    conditions.length > 1 ||
    (conditions.length === 1 && conditions[0]!.type !== "always")
  ) {
    return err(
      "編集できませんでした。条件が設定されている Blueprint はこのフォームで編集できません",
    );
  }
  const actions = blueprint.actions;
  if (
    actions.length !== 1 ||
    actions[0]!.type !== "sendToChannel" ||
    actions[0]!.channelId !== trigger.channelId ||
    actions[0]!.template !== trigger.template
  ) {
    return err(
      "編集できませんでした。アクションの構成が異なる Blueprint はこのフォームで編集できません",
    );
  }
  if (trigger.type === "reaction") {
    return ok({
      kind: "reaction",
      input: {
        name: blueprint.name,
        emoji: trigger.emoji ?? "",
        threshold: String(trigger.threshold),
        channelId: trigger.channelId,
        template: trigger.template,
      },
    });
  }
  return ok({
    kind: "schedule",
    input: {
      name: blueprint.name,
      dailyTime: trigger.dailyTime ?? "",
      intervalMinutes:
        trigger.intervalMinutes === undefined
          ? ""
          : String(trigger.intervalMinutes),
      channelId: trigger.channelId,
      template: trigger.template,
      timezone: trigger.timezone,
    },
  });
}
