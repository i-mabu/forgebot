// ===============================
// 1. リアクション自動提案の入力
// ===============================

import {
  validateMemoryKey,
  validateMemoryProposal,
  type MemoryProposalInput,
} from "./memory.js";

export interface AutoMemoryMessageInput {
  messageId: string;
  authorId: string;
  authorBot: boolean;
  content: string;
}

export interface AutoMemoryProposal extends MemoryProposalInput {
  createdBy: string;
}

// 自動提案の種別は「名言」固定。本文がそのまま引用候補になるため。
export const AUTO_MEMORY_KIND = "quote";
// キーはメッセージ ID から決定的に作る。同じメッセージからは
// 常に同じキーになることが、重複防止（冪等性）の前提になる。
export const AUTO_MEMORY_KEY_PREFIX = "reaction-";

// =====================
// 2. 候補入力の構築
// =====================

export function autoMemoryKey(messageId: string): string | null {
  const key = validateMemoryKey(AUTO_MEMORY_KEY_PREFIX + messageId);
  return key.ok ? key.value : null;
}

// 候補化しないメッセージでは null を返す:
// - Bot のメッセージ（Bot 自身の自動化の出力が候補になる循環を防ぐ）
// - 本文が空（埋め込み・添付のみ）のメッセージ
// - 記憶の上限（500 文字）を超える本文
// 本文の検証は手動 propose と同じ validateMemoryProposal を使う。
export function buildAutoMemoryProposal(
  input: AutoMemoryMessageInput,
): AutoMemoryProposal | null {
  if (input.authorBot) return null;
  const key = autoMemoryKey(input.messageId);
  if (key === null) return null;
  const validated = validateMemoryProposal({
    key,
    kind: AUTO_MEMORY_KIND,
    content: input.content,
  });
  if (!validated.ok) return null;
  return { ...validated.value, createdBy: input.authorId };
}
