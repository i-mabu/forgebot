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

test("非整数・上限超えのクールダウンを拒否する", () => {
  assert.throws(
    () => validateBlueprint(base({ cooldownSeconds: 1.5 })),
    /cooldownSeconds/,
  );
  assert.throws(
    () => validateBlueprint(base({ cooldownSeconds: 86401 })),
    /cooldownSeconds/,
  );
  // フォーム経路と同じ上限 (86400) ちょうどは受け付ける。
  const blueprint = validateBlueprint(base({ cooldownSeconds: 86400 }));
  assert.equal(blueprint.cooldownSeconds, 86400);
});

test("event トリガーは未対応として拒否する", () => {
  assert.throws(
    () =>
      validateBlueprint(
        base({ trigger: { type: "event", event: "guildMemberAdd" } }),
      ),
    /event trigger is not supported yet/,
  );
});

test("カウンター加算量の範囲外を拒否する", () => {
  const withAmount = (amount: number) =>
    base({
      actions: [{ type: "incrementCounter", key: "visits", amount }],
    });
  assert.throws(() => validateBlueprint(withAmount(0)), /amount/);
  assert.throws(() => validateBlueprint(withAmount(1001)), /amount/);
  assert.throws(() => validateBlueprint(withAmount(-1001)), /amount/);
  // 範囲の両端（負数 = 減算も含む）は受け付ける。
  assert.equal(validateBlueprint(withAmount(1000)).actions.length, 1);
  assert.equal(validateBlueprint(withAmount(-1000)).actions.length, 1);
});
