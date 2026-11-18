// =====================
// 1. テンプレートの型
// =====================

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlueprint, type Blueprint } from "./blueprint.js";
import {
  createBlueprint,
  type SaveBlueprintResult,
} from "./blueprintService.js";
import type { Store } from "./store.js";

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  blueprint: Blueprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// =====================
// 2. 同梱テンプレート集
// =====================

const EMBEDDED: unknown = {
  version: 1,
  templates: [
    {
      id: "omikuji",
      name: "おみくじ",
      description: "実行するたびに運勢をランダムで返す",
      blueprint: {
        name: "omikuji",
        trigger: { type: "slash", command: "omikuji" },
        conditions: [{ type: "always" }],
        actions: [
          {
            type: "reply",
            template: "{user} の運勢: {choice:大吉,中吉,小吉,末吉,凶}",
          },
        ],
      },
    },
    {
      id: "visit-counter",
      name: "訪問カウンター",
      description: "実行回数を数えて表示する",
      blueprint: {
        name: "visit",
        trigger: { type: "slash", command: "visit" },
        conditions: [{ type: "always" }],
        actions: [
          { type: "incrementCounter", key: "visits", amount: 1 },
          { type: "reply", template: "{user} は {count:visits} 回目" },
        ],
      },
    },
    {
      id: "reaction-star",
      name: "リアクション達成通知",
      description: "リアクションが5件に達したら通知する",
      blueprint: {
        name: "reaction-star",
        trigger: {
          type: "reaction",
          threshold: 5,
          channelId: "0",
          template:
            "{messageUrl} が {reactionCount} 件のリアクションに達しました",
        },
        conditions: [{ type: "always" }],
        actions: [
          {
            type: "sendToChannel",
            channelId: "0",
            template:
              "{messageUrl} が {reactionCount} 件のリアクションに達しました",
          },
        ],
      },
    },
  ],
};

function parseGallery(raw: unknown): GalleryTemplate[] {
  if (!isRecord(raw) || !Array.isArray(raw.templates)) return [];
  const templates: GalleryTemplate[] = [];
  for (const entry of raw.templates) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.description !== "string"
    ) {
      continue;
    }
    try {
      templates.push({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        blueprint: validateBlueprint(entry.blueprint as unknown),
      });
    } catch {
      // 不正なテンプレートはギャラリー全体を落とさず除外する。
      continue;
    }
  }
  return templates;
}

export function loadGalleryTemplates(): GalleryTemplate[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "templates", "gallery.json"),
    join(here, "..", "..", "templates", "gallery.json"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = parseGallery(JSON.parse(readFileSync(candidate, "utf-8")));
      if (parsed.length > 0) return parsed;
    } catch {
      continue;
    }
  }
  return parseGallery(EMBEDDED);
}

// =====================
// 3. ギャラリーの参照
// =====================

export function listGalleryTemplates(
  templates: GalleryTemplate[] = loadGalleryTemplates(),
): GalleryTemplate[] {
  return [...templates].sort((a, b) => a.id.localeCompare(b.id));
}

export function getGalleryTemplate(
  id: string,
  templates: GalleryTemplate[] = loadGalleryTemplates(),
): GalleryTemplate | null {
  return templates.find((t) => t.id === id) ?? null;
}

// =====================
// 4. ギャラリーからの取り込み
// =====================

// テンプレートをそのギルドの Blueprint として保存する。
// 既存の作成チェック（同名・上限）をそのまま使う。
export function importGalleryTemplate(
  store: Store,
  guildId: string,
  templateId: string,
  newName?: string,
  templates: GalleryTemplate[] = loadGalleryTemplates(),
): SaveBlueprintResult | { ok: false; reason: "not_found"; message: string } {
  const template = getGalleryTemplate(templateId, templates);
  if (template === null) {
    return {
      ok: false,
      reason: "not_found",
      message: `見つかりませんでした: ${templateId}`,
    };
  }
  const blueprint: Blueprint =
    newName !== undefined && newName !== ""
      ? {
          ...template.blueprint,
          name: newName,
          trigger:
            template.blueprint.trigger.type === "slash"
              ? { type: "slash", command: newName }
              : template.blueprint.trigger,
        }
      : template.blueprint;
  return createBlueprint(store, guildId, blueprint);
}
