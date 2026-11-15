// =======================
// 1. リアクション判定の型
// =======================

import type { ReactionTrigger } from "./blueprint.js";

export interface ReactionMatchInput {
  // 絵文字キー（名前・ID・文字列表現）ごとのリアクション数
  emojiCounts: Readonly<Record<string, number>>;
  totalCount: number;
  alreadyFired: boolean;
}

// ===============
// 2. トリガー照合
// ===============

export function reactionCountFor(
  trigger: ReactionTrigger,
  input: ReactionMatchInput,
): number {
  if (trigger.emoji === undefined) return input.totalCount;
  return input.emojiCounts[trigger.emoji] ?? 0;
}

export function matchesReactionTrigger(
  trigger: ReactionTrigger,
  input: ReactionMatchInput,
): boolean {
  if (input.alreadyFired) return false;
  return reactionCountFor(trigger, input) >= trigger.threshold;
}
