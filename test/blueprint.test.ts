import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BlueprintValidationError,
  MAX_ACTIONS,
  validateBlueprint,
} from "../src/blueprint.js";

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "omikuji",
    trigger: { type: "slash", command: "omikuji" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "結果: {random:1-6}" }],
    ...overrides,
  };
}

test("正しい Blueprint を受け付ける", () => {
  const blueprint = validateBlueprint(base());
  assert.equal(blueprint.name, "omikuji");
  assert.equal(blueprint.actions.length, 1);
});

test("名前が空なら拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ name: "  " })),
    (error: unknown) =>
      error instanceof BlueprintValidationError &&
      error.message === "Blueprint name is required",
  );
});

test("名前に空白を含むなら拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ name: "omi kuji" })),
    /must not contain whitespace/,
  );
});

test("未知のトリガー種別を拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ trigger: { type: "cron" } })),
    /Unknown trigger type: cron/,
  );
});

test("未知の条件種別を拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ conditions: [{ type: "hasRole" }] })),
    /Unknown condition type: hasRole/,
  );
});

test("未知のアクション種別を拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ actions: [{ type: "ban" }] })),
    /Unknown action type: ban/,
  );
});

test("アクションが上限を超えたら拒否する", () => {
  const actions = Array.from({ length: MAX_ACTIONS + 1 }, () => ({
    type: "reply",
    template: "x",
  }));
  assert.throws(
    () => validateBlueprint(base({ actions })),
    new RegExp(`too many actions: ${MAX_ACTIONS + 1}`),
  );
});

test("アクションが空なら拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ actions: [] })),
    /at least one action/,
  );
});

test("chance の範囲外を拒否する", () => {
  assert.throws(
    () =>
      validateBlueprint(
        base({ conditions: [{ type: "chance", percent: 101 }] }),
      ),
    /percent between 0 and 100/,
  );
});

test("不正な Presentation の色を拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ presentation: { color: -1 } })),
    /presentation color/,
  );
});

test("負のクールダウンを拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ cooldownSeconds: -5 })),
    /cooldownSeconds/,
  );
});
