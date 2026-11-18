import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint, type Blueprint } from "../src/blueprint.js";
import {
  buildBlueprintFromForm,
  extractSimpleForm,
  parseCooldownSeconds,
  parseCounterKey,
  renderBlueprintPreview,
  validateCommandName,
} from "../src/blueprintForm.js";

test("コマンド名は小文字の英数字を受け付ける", () => {
  const result = validateCommandName("omikuji2");
  assert.deepEqual(result, { ok: true, value: "omikuji2" });
});

test("コマンド名は大文字を小文字に正規化する", () => {
  const result = validateCommandName("Omikuji");
  assert.deepEqual(result, { ok: true, value: "omikuji" });
});

test("コマンド名は日本語とハイフンとアンダースコアを受け付ける", () => {
  assert.deepEqual(validateCommandName("おみくじ"), {
    ok: true,
    value: "おみくじ",
  });
  assert.deepEqual(validateCommandName("my-command_1"), {
    ok: true,
    value: "my-command_1",
  });
});

test("コマンド名は空と空白を拒否する", () => {
  assert.equal(validateCommandName("").ok, false);
  assert.equal(validateCommandName("   ").ok, false);
  assert.equal(validateCommandName("omi kuji").ok, false);
});

test("コマンド名は使用できない文字を拒否する", () => {
  assert.equal(validateCommandName("omikuji!").ok, false);
  assert.equal(validateCommandName("omi/kuji").ok, false);
  assert.equal(validateCommandName("omi.kuji").ok, false);
});

test("コマンド名は32文字を超えたら拒否する", () => {
  assert.equal(validateCommandName("a".repeat(32)).ok, true);
  assert.equal(validateCommandName("a".repeat(33)).ok, false);
  assert.equal(validateCommandName("あ".repeat(33)).ok, false);
});

test("クールダウンは空なら0秒になる", () => {
  assert.deepEqual(parseCooldownSeconds(""), { ok: true, value: 0 });
  assert.deepEqual(parseCooldownSeconds("  "), { ok: true, value: 0 });
});

test("クールダウンは整数秒を受け付ける", () => {
  assert.deepEqual(parseCooldownSeconds("30"), { ok: true, value: 30 });
  assert.deepEqual(parseCooldownSeconds("86400"), {
    ok: true,
    value: 86400,
  });
});

test("クールダウンは不正な値を拒否する", () => {
  assert.equal(parseCooldownSeconds("abc").ok, false);
  assert.equal(parseCooldownSeconds("-5").ok, false);
  assert.equal(parseCooldownSeconds("1.5").ok, false);
  assert.equal(parseCooldownSeconds("86401").ok, false);
});

test("カウンターキーは空なら null になる", () => {
  assert.deepEqual(parseCounterKey(""), { ok: true, value: null });
  assert.deepEqual(parseCounterKey("visits"), {
    ok: true,
    value: "visits",
  });
});

test("カウンターキーは空白を含む値を拒否する", () => {
  assert.equal(parseCounterKey("my counter").ok, false);
});

test("フォームからカウンター付き Blueprint を構築する", () => {
  const result = buildBlueprintFromForm({
    name: "visit",
    template: "訪問 {count:visits} 回目",
    cooldown: "60",
    counterKey: "visits",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const blueprint = result.value;
  assert.equal(blueprint.name, "visit");
  assert.deepEqual(blueprint.trigger, { type: "slash", command: "visit" });
  assert.deepEqual(blueprint.conditions, [{ type: "always" }]);
  assert.deepEqual(blueprint.actions, [
    { type: "incrementCounter", key: "visits", amount: 1 },
    { type: "reply", template: "訪問 {count:visits} 回目" },
  ]);
  assert.equal(blueprint.cooldownSeconds, 60);
});

test("フォームからカウンターなし Blueprint を構築する", () => {
  const result = buildBlueprintFromForm({
    name: "omikuji",
    template: "{user}: {choice:大吉,凶}",
    cooldown: "",
    counterKey: "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.actions, [
    { type: "reply", template: "{user}: {choice:大吉,凶}" },
  ]);
  assert.equal(result.value.cooldownSeconds, undefined);
});

test("フォームは空のテンプレートを拒否する", () => {
  const result = buildBlueprintFromForm({
    name: "omikuji",
    template: "  ",
    cooldown: "",
    counterKey: "",
  });
  assert.equal(result.ok, false);
});

test("フォームは不正なクールダウンを拒否する", () => {
  const result = buildBlueprintFromForm({
    name: "omikuji",
    template: "x",
    cooldown: "soon",
    counterKey: "",
  });
  assert.equal(result.ok, false);
});

test("単純な Blueprint をフォームへ復元できる", () => {
  const blueprint = validateBlueprint({
    name: "visit",
    trigger: { type: "slash", command: "visit" },
    conditions: [{ type: "always" }],
    actions: [
      { type: "incrementCounter", key: "visits", amount: 1 },
      { type: "reply", template: "訪問 {count:visits} 回目" },
    ],
    cooldownSeconds: 30,
  });
  const result = extractSimpleForm(blueprint);
  assert.deepEqual(result, {
    ok: true,
    value: {
      name: "visit",
      template: "訪問 {count:visits} 回目",
      cooldown: "30",
      counterKey: "visits",
    },
  });
});

test("複雑なアクション構成はフォームへ復元できない", () => {
  const blueprint = validateBlueprint({
    name: "complex",
    trigger: { type: "slash", command: "complex" },
    conditions: [{ type: "always" }],
    actions: [
      { type: "setVariable", key: "mood", value: "good" },
      { type: "reply", template: "x" },
    ],
  });
  const result = extractSimpleForm(blueprint);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /アクションの構成/);
});

test("条件付き Blueprint はフォームへ復元できない", () => {
  const blueprint = validateBlueprint({
    name: "cond",
    trigger: { type: "slash", command: "cond" },
    conditions: [{ type: "chance", percent: 50 }],
    actions: [{ type: "reply", template: "x" }],
  });
  assert.equal(extractSimpleForm(blueprint).ok, false);
});

test("イベント Trigger はフォームへ復元できない", () => {
  // event Trigger は検証では弾かれるため、保存済みデータ相当の
  // オブジェクトを直接組み立てて復元可否だけを見る。
  const blueprint: Blueprint = {
    name: "evt",
    trigger: { type: "event", event: "guildMemberAdd" },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "x" }],
  };
  assert.equal(extractSimpleForm(blueprint).ok, false);
});

test("プレビューはカウンター加算後の値を描画し実値は変えない", () => {
  const blueprint = validateBlueprint({
    name: "visit",
    trigger: { type: "slash", command: "visit" },
    conditions: [{ type: "always" }],
    actions: [
      { type: "incrementCounter", key: "visits", amount: 2 },
      { type: "reply", template: "{user}: 訪問 {count:visits} 回" },
    ],
  });
  let stored = 10;
  const outputs = renderBlueprintPreview(blueprint, {
    user: "taro",
    server: "テストサーバー",
    getCounter: () => stored,
  });
  assert.deepEqual(outputs, ["taro: 訪問 12 回"]);
  assert.equal(stored, 10);
});
