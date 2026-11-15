import assert from "node:assert/strict";
import { test } from "node:test";
import { RenderError, renderTemplate } from "../src/render.js";

function ctx(overrides: Partial<Parameters<typeof renderTemplate>[1]> = {}) {
  return {
    user: "taro",
    server: "テストサーバー",
    getCounter: (key: string) => (key === "visits" ? 42 : 0),
    getVariable: (key: string) => (key === "mood" ? "good" : null),
    rng: () => 0,
    ...overrides,
  };
}

test("{user} と {server} を置換する", () => {
  assert.equal(
    renderTemplate("{user} in {server}", ctx()),
    "taro in テストサーバー",
  );
});

test("{count:key} をカウンター値に置換する", () => {
  assert.equal(renderTemplate("訪問: {count:visits}回", ctx()), "訪問: 42回");
  assert.equal(renderTemplate("{count:unknown}", ctx()), "0");
});

test("{random:min-max} は rng=0 で下限を返す", () => {
  assert.equal(renderTemplate("{random:1-100}", ctx({ rng: () => 0 })), "1");
});

test("{random:min-max} は上限を超えない", () => {
  assert.equal(
    renderTemplate("{random:1-100}", ctx({ rng: () => 0.999999 })),
    "100",
  );
  assert.equal(renderTemplate("{random:5-5}", ctx({ rng: () => 0.5 })), "5");
});

test("{random} の不正な範囲はエラーになる", () => {
  assert.throws(() => renderTemplate("{random:10-1}", ctx()), RenderError);
  assert.throws(() => renderTemplate("{random:a-b}", ctx()), RenderError);
});

test("{choice:a,b,c} は rng に応じて選ぶ", () => {
  assert.equal(
    renderTemplate("{choice:大吉,中吉,小吉}", ctx({ rng: () => 0 })),
    "大吉",
  );
  assert.equal(
    renderTemplate("{choice:大吉,中吉,小吉}", ctx({ rng: () => 0.999 })),
    "小吉",
  );
});

test("{var:key} を変数に置換し、無ければ空になる", () => {
  assert.equal(renderTemplate("気分: {var:mood}", ctx()), "気分: good");
  assert.equal(renderTemplate("[{var:missing}]", ctx()), "[]");
});

test("未知のプレースホルダはそのまま残す", () => {
  assert.equal(renderTemplate("{unknown}", ctx()), "{unknown}");
});
