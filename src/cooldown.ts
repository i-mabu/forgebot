// =========================
// 1. クールダウン管理の基盤
// =========================

export interface CooldownCheck {
  allowed: boolean;
  remainingMs: number;
}

// =========================
// 2. CooldownTracker クラス
// =========================

// check と record を分けている: 判定だけでは消費せず、
// 実行が成功したときに呼び出し側 (engine) が record する。
export class CooldownTracker {
  private readonly lastUsed = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  check(key: string, cooldownSeconds: number): CooldownCheck {
    if (cooldownSeconds <= 0) return { allowed: true, remainingMs: 0 };
    const last = this.lastUsed.get(key);
    if (last === undefined) return { allowed: true, remainingMs: 0 };
    const remainingMs = last + cooldownSeconds * 1000 - this.now();
    if (remainingMs <= 0) return { allowed: true, remainingMs: 0 };
    return { allowed: false, remainingMs };
  }

  record(key: string): void {
    this.lastUsed.set(key, this.now());
  }

  clear(key: string): void {
    this.lastUsed.delete(key);
  }

  clearAll(): void {
    this.lastUsed.clear();
  }
}

export function cooldownKey(
  guildId: string,
  blueprintName: string,
  userId: string,
): string {
  return `${guildId}:${blueprintName}:${userId}`;
}
