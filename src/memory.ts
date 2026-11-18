// =====================
// 1. 記憶の型と上限
// =====================

export type MemoryStatus = "pending" | "approved" | "rejected";

export interface MemoryRecord {
  guildId: string;
  key: string;
  kind: string;
  content: string;
  status: MemoryStatus;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MEMORY_KINDS = ["quote", "anniversary", "note"] as const;
export const MAX_MEMORY_KEY_LENGTH = 32;
export const MAX_MEMORY_CONTENT_LENGTH = 500;
export const MAX_MEMORY_KIND_LENGTH = 32;

const MEMORY_KEY_PATTERN = /^[-\p{L}\p{N}_]+$/u;

export type MemoryValidationResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

function ok<T>(value: T): MemoryValidationResult<T> {
  return { ok: true, value };
}
function err<T>(message: string): MemoryValidationResult<T> {
  return { ok: false, message };
}

// =====================
// 2. 記憶入力の検証
// =====================

export function validateMemoryKey(raw: string): MemoryValidationResult<string> {
  const key = raw.trim().toLowerCase();
  if (key === "") return err("キーが空です");
  if ([...key].length > MAX_MEMORY_KEY_LENGTH) {
    return err(
      `キーが長すぎます: ${[...key].length} 文字 (上限 ${MAX_MEMORY_KEY_LENGTH} 文字)`,
    );
  }
  if (!MEMORY_KEY_PATTERN.test(key)) {
    return err(
      "キーに使用できない文字が含まれています: 使用できるのは文字・数字・ハイフン・アンダースコアです",
    );
  }
  return ok(key);
}

export function validateMemoryKind(
  raw: string,
): MemoryValidationResult<string> {
  const kind = raw.trim();
  if (kind === "") return err("種別が空です");
  if ([...kind].length > MAX_MEMORY_KIND_LENGTH) {
    return err(
      `種別が長すぎます: ${[...kind].length} 文字 (上限 ${MAX_MEMORY_KIND_LENGTH} 文字)`,
    );
  }
  return ok(kind);
}

export function validateMemoryContent(
  raw: string,
): MemoryValidationResult<string> {
  const content = raw.trim();
  if (content === "") return err("内容が空です");
  if ([...content].length > MAX_MEMORY_CONTENT_LENGTH) {
    return err(
      `内容が長すぎます: ${[...content].length} 文字 (上限 ${MAX_MEMORY_CONTENT_LENGTH} 文字)`,
    );
  }
  return ok(content);
}

export interface MemoryProposalInput {
  key: string;
  kind: string;
  content: string;
}

export function validateMemoryProposal(
  input: MemoryProposalInput,
): MemoryValidationResult<MemoryProposalInput> {
  const key = validateMemoryKey(input.key);
  if (!key.ok) return key;
  const kind = validateMemoryKind(input.kind);
  if (!kind.ok) return kind;
  const content = validateMemoryContent(input.content);
  if (!content.ok) return content;
  return ok({ key: key.value, kind: kind.value, content: content.value });
}
