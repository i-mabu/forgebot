// =====================
// 1. 親密度段階の定義
// =====================

export interface GrowthInfo {
  level: number;
  label: string;
  executions: number;
  activeDays: number;
}

export interface GrowthRecord {
  guildId: string;
  totalExecutions: number;
  activeDays: number;
  lastActiveDate: string | null;
  firstActiveAt: string | null;
}

const STAGE_LABELS: Record<number, string> = {
  1: "始動",
  2: "定着",
  3: "活発",
  4: "成熟",
  5: "熟練",
};

// =====================
// 2. 段階の算出（純粋関数）
// =====================

// 親密度の段階は実行総数と稼働日数の両方で決まる。
// 段階は表現のみに使い、基本機能のロックには使わない。
export function computeGrowthStage(
  executions: number,
  activeDays: number,
): GrowthInfo {
  const exec = Math.max(0, Math.floor(executions));
  const days = Math.max(0, Math.floor(activeDays));
  let level = 1;
  if (exec >= 10 && days >= 1) level = 2;
  if (exec >= 50 && days >= 7) level = 3;
  if (exec >= 200 && days >= 30) level = 4;
  if (exec >= 500 && days >= 60) level = 5;
  return {
    level,
    label: STAGE_LABELS[level] ?? "始動",
    executions: exec,
    activeDays: days,
  };
}

export function growthFromRecord(
  record: GrowthRecord | null,
  fallbackExecutions = 0,
): GrowthInfo {
  if (record === null) return computeGrowthStage(fallbackExecutions, 0);
  return computeGrowthStage(record.totalExecutions, record.activeDays);
}
