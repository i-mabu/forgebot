// =====================
// 1. 権限チェックの基盤
// =====================

import { PermissionFlagsBits } from "discord.js";

export interface PermissionSet {
  has(flag: bigint): boolean;
}

export const MANAGE_GUILD_MISSING_MESSAGE =
  "実行できませんでした。権限が不足しています: ManageGuild";

// =====================
// 2. ManageGuild の判定
// =====================

// ビルダーの初期権限だけに頼らず、ハンドラ側で再チェックするための判定。
export function hasManageGuild(
  permissions: PermissionSet | null | undefined,
): boolean {
  if (permissions === null || permissions === undefined) return false;
  return permissions.has(PermissionFlagsBits.ManageGuild);
}
