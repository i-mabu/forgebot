// =========================
// 1. スケジュールの型と検証
// =========================

import type { ScheduleTrigger } from "./blueprint.js";

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseDailyTime(
  value: string,
): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// ===================
// 2. タイムゾーン変換
// ===================

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(timezone: string, date: Date): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

// そのタイムゾーンでの壁時計の日時に対応する UTC の瞬間を返す。
// 変換は反復で求める: まず壁時計の日時を UTC とみなして仮の瞬間を作り、
// その瞬間をタイムゾーンの壁時計へ戻した値との差で補正する。
// 夏時間の切り替え前後でもずれないよう、差が 0 になるまで最大3回繰り返す。
function wallToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = wallParts(timezone, new Date(utc));
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = target - asUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

function occurrenceOnWallDate(
  trigger: ScheduleTrigger,
  year: number,
  month: number,
  day: number,
): Date {
  const time = parseDailyTime(trigger.dailyTime ?? "");
  if (time === null) {
    throw new Error("schedule trigger requires dailyTime");
  }
  return wallToUtc(trigger.timezone, year, month, day, time.hour, time.minute);
}

function shiftWallDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// =========================
// 3. 日次スケジュールの計算
// =========================

// now 以前で最も最近の日次実行時刻を返す。
export function lastDailyOccurrence(trigger: ScheduleTrigger, now: Date): Date {
  const parts = wallParts(trigger.timezone, now);
  const today = occurrenceOnWallDate(
    trigger,
    parts.year,
    parts.month,
    parts.day,
  );
  if (today.getTime() <= now.getTime()) return today;
  const prev = shiftWallDate(parts.year, parts.month, parts.day, -1);
  return occurrenceOnWallDate(trigger, prev.year, prev.month, prev.day);
}

// after より後で最も近い日次実行時刻を返す。
export function nextDailyOccurrence(
  trigger: ScheduleTrigger,
  after: Date,
): Date {
  const parts = wallParts(trigger.timezone, after);
  const today = occurrenceOnWallDate(
    trigger,
    parts.year,
    parts.month,
    parts.day,
  );
  if (today.getTime() > after.getTime()) return today;
  const next = shiftWallDate(parts.year, parts.month, parts.day, 1);
  return occurrenceOnWallDate(trigger, next.year, next.month, next.day);
}

// =============
// 4. 実行判定
// =============

export function isScheduleDue(
  trigger: ScheduleTrigger,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  if (trigger.intervalMinutes !== undefined) {
    if (lastRunAt === null) return true;
    return (
      lastRunAt.getTime() + trigger.intervalMinutes * 60_000 <= now.getTime()
    );
  }
  if (lastRunAt === null) return true;
  const occurrence = lastDailyOccurrence(trigger, now);
  return lastRunAt.getTime() < occurrence.getTime();
}
