// ===================
// 1. ドラフトの型定義
// ===================

import { randomUUID } from "node:crypto";
import type { Blueprint } from "./blueprint.js";

export const DRAFT_TTL_MS = 10 * 60 * 1000;

export type DraftData =
  | { kind: "create"; blueprint: Blueprint }
  | { kind: "edit"; blueprint: Blueprint; originalName: string }
  | { kind: "delete"; name: string }
  | { kind: "dataDelete" }
  | { kind: "importChannel"; blueprint: Blueprint };

export interface DraftSession {
  id: string;
  guildId: string;
  userId: string;
  data: DraftData;
  createdAt: number;
  expiresAt: number;
}

// ====================
// 2. DraftStore クラス
// ====================

// 保存・削除の確認待ち状態をメモリに保持する。永続化はしない。
export class DraftStore {
  private readonly sessions = new Map<string, DraftSession>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly createId: () => string;

  constructor(
    now: () => number = Date.now,
    ttlMs: number = DRAFT_TTL_MS,
    createId: () => string = randomUUID,
  ) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.createId = createId;
  }

  put(guildId: string, userId: string, data: DraftData): DraftSession {
    this.prune();
    const createdAt = this.now();
    const session: DraftSession = {
      id: this.createId(),
      guildId,
      userId,
      data,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): DraftSession | null {
    const session = this.sessions.get(id);
    if (session === undefined) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  // 取得と同時に削除する。確認は1回限りで、同じドラフトを二重に確定できない。
  take(id: string): DraftSession | null {
    const session = this.get(id);
    if (session === null) return null;
    this.sessions.delete(id);
    return session;
  }

  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }
}

// ===============
// 3. 所有者の判定
// ===============

export function isDraftOwner(
  session: DraftSession,
  guildId: string,
  userId: string,
): boolean {
  return session.guildId === guildId && session.userId === userId;
}

// ========================
// 4. customId の構築と解釈
// ========================

export type DraftButtonAction = "confirm" | "cancel";

const DRAFT_CUSTOM_ID_PREFIX = "forge:draft:";

export function buildDraftCustomId(
  action: DraftButtonAction,
  id: string,
): string {
  return `${DRAFT_CUSTOM_ID_PREFIX}${action}:${id}`;
}

export function parseDraftCustomId(
  customId: string,
): { action: DraftButtonAction; id: string } | null {
  if (!customId.startsWith(DRAFT_CUSTOM_ID_PREFIX)) return null;
  const rest = customId.slice(DRAFT_CUSTOM_ID_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator < 0) return null;
  const action = rest.slice(0, separator);
  const id = rest.slice(separator + 1);
  if (action !== "confirm" && action !== "cancel") return null;
  if (id === "") return null;
  return { action, id };
}
