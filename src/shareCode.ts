// ===================
// 1. 共有コードの形式
// ===================

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BlueprintValidationError,
  validateBlueprint,
  type Blueprint,
} from "./blueprint.js";

// 形式: FORGE1-<sha256 先頭8桁>-<gzip した JSON の base64url>
export const SHARE_CODE_PREFIX = "FORGE1-";
export const SHARE_CODE_VERSION = 1;
const CHECKSUM_LENGTH = 8;
// 展開後の JSON の上限。Blueprint の JSON は通常数 KB に収まるため
// 1 MiB あれば十分で、zip bomb 的な入力でメモリを圧迫させない。
const MAX_SHARE_CODE_JSON_BYTES = 1024 * 1024;

export class ShareCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareCodeError";
  }
}

function checksumOf(payload: Buffer): string {
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, CHECKSUM_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// =============
// 2. エンコード
// =============

export function encodeShareCode(blueprint: Blueprint): string {
  const json = JSON.stringify({
    version: SHARE_CODE_VERSION,
    blueprint,
  });
  const payload = gzipSync(Buffer.from(json, "utf-8"));
  return `${SHARE_CODE_PREFIX}${checksumOf(payload)}-${payload.toString("base64url")}`;
}

// =================
// 3. デコードと検証
// =================

export function decodeShareCode(code: string): Blueprint {
  // チャットやファイル経由で改行・空白が混ざって貼られても読めるよう先に除去する。
  const compact = code.replace(/\s+/g, "");
  if (!compact.startsWith(SHARE_CODE_PREFIX)) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードは FORGE1- で始まる必要があります",
    );
  }
  const rest = compact.slice(SHARE_CODE_PREFIX.length);
  const separator = rest.indexOf("-");
  if (separator < 0) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの形式が不正です",
    );
  }
  const checksum = rest.slice(0, separator);
  const data = rest.slice(separator + 1);
  const payload = Buffer.from(data, "base64url");
  if (payload.length === 0 || checksumOf(payload) !== checksum) {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードのチェックサムが一致しません",
    );
  }
  let json: string;
  try {
    json = gunzipSync(payload, {
      maxOutputLength: MAX_SHARE_CODE_JSON_BYTES,
    }).toString("utf-8");
  } catch {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードを展開できませんでした",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの内容が不正です",
    );
  }
  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    throw new ShareCodeError(
      "読み込みできませんでした。共有コードの内容が不正です",
    );
  }
  if (parsed.version !== SHARE_CODE_VERSION) {
    throw new ShareCodeError(
      `読み込みできませんでした。共有コードのバージョンに対応していません: ${parsed.version}`,
    );
  }
  try {
    return validateBlueprint(parsed.blueprint);
  } catch (error) {
    if (error instanceof BlueprintValidationError) {
      throw new ShareCodeError(
        `読み込みできませんでした。Blueprint が不正です: ${error.message}`,
      );
    }
    throw error;
  }
}
