// =========================
// 1. テンプレート描画の基盤
// =========================

export interface RenderContext {
  user: string;
  server: string;
  messageUrl?: string;
  reactionCount?: number;
  getCounter: (key: string) => number;
  getVariable?: (key: string) => string | null;
  rng?: () => number;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

const PLACEHOLDER = /\{([^{}]+)\}/g;

// =====================
// 2. プレースホルダ解決
// =====================

function resolvePlaceholder(raw: string, ctx: RenderContext): string {
  const rng = ctx.rng ?? Math.random;
  if (raw === "user") return ctx.user;
  if (raw === "server") return ctx.server;
  if (raw === "messageUrl") return ctx.messageUrl ?? "";
  if (raw === "reactionCount") {
    return ctx.reactionCount === undefined ? "" : String(ctx.reactionCount);
  }
  if (raw.startsWith("count:")) {
    const key = raw.slice("count:".length);
    if (key === "") throw new RenderError("{count:} requires a key");
    return String(ctx.getCounter(key));
  }
  if (raw.startsWith("var:")) {
    const key = raw.slice("var:".length);
    if (key === "") throw new RenderError("{var:} requires a key");
    return ctx.getVariable?.(key) ?? "";
  }
  if (raw.startsWith("random:")) {
    const parts = raw.slice("random:".length).split("-");
    if (parts.length !== 2) {
      throw new RenderError(
        `{random:} requires a range like {random:1-100}: {${raw}}`,
      );
    }
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RenderError(
        `{random:} requires integer bounds with min <= max: {${raw}}`,
      );
    }
    return String(min + Math.floor(rng() * (max - min + 1)));
  }
  if (raw.startsWith("choice:")) {
    const options = raw
      .slice("choice:".length)
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option !== "");
    if (options.length === 0) {
      throw new RenderError("{choice:} requires at least one option");
    }
    // rng() が 1 を返した場合に範囲外にならないよう上限で丸める。
    const index = Math.min(
      options.length - 1,
      Math.floor(rng() * options.length),
    );
    return options[index] ?? options[0]!;
  }
  // 未知のプレースホルダはエラーにせず、元の表記のまま残す。
  return `{${raw}}`;
}

// ===================
// 3. テンプレート描画
// ===================

export function renderTemplate(template: string, ctx: RenderContext): string {
  return template.replace(PLACEHOLDER, (_match, raw: string) =>
    resolvePlaceholder(raw, ctx),
  );
}
