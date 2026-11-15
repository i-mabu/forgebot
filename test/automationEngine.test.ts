import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BlueprintValidationError,
  validateBlueprint,
  type Blueprint,
} from "../src/blueprint.js";
import { CooldownTracker } from "../src/cooldown.js";
import { executeBlueprint, type EngineDeps } from "../src/engine.js";
import { Store } from "../src/store.js";

function makeDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    store: new Store(":memory:"),
    cooldowns: new CooldownTracker(),
    globalDisabled: false,
    rng: () => 0,
    ...overrides,
  };
}

function reactionBlueprint(): Blueprint {
  return validateBlueprint({
    name: "meigen",
    trigger: {
      type: "reaction",
      emoji: "⭐",
      threshold: 5,
      channelId: "111",
      template: "{user} の {messageUrl} が {reactionCount} 件",
    },
    conditions: [{ type: "always" }],
    actions: [
      {
        type: "sendToChannel",
        channelId: "111",
        template: "{user} の {messageUrl} が {reactionCount} 件",
      },
    ],
  });
}

test("sendToChannel は送信先と描画結果を返す", () => {
  const deps = makeDeps();
  const result = executeBlueprint(reactionBlueprint(), deps, {
    guildId: "g1",
    userId: "u1",
    userName: "taro",
    serverName: "テストサーバー",
    messageUrl: "https://discord.com/channels/g1/c1/m1",
    reactionCount: 5,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.actions, [
    {
      type: "sendToChannel",
      channelId: "111",
      text: "taro の https://discord.com/channels/g1/c1/m1 が 5 件",
    },
  ]);
  deps.store.close();
});

test("sendToChannel も全局停止スイッチでブロックされる", () => {
  const deps = makeDeps({ globalDisabled: true });
  const result = executeBlueprint(reactionBlueprint(), deps, {
    guildId: "g1",
    userId: "u1",
    userName: "taro",
    serverName: "テストサーバー",
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.actions, []);
  deps.store.close();
});

test("リアクション Trigger の不正な閾値は拒否される", () => {
  for (const threshold of [0, -1, 1.5, 1001]) {
    assert.throws(
      () =>
        validateBlueprint({
          name: "x",
          trigger: {
            type: "reaction",
            threshold,
            channelId: "111",
            template: "送信",
          },
          conditions: [],
          actions: [
            { type: "sendToChannel", channelId: "111", template: "送信" },
          ],
        }),
      BlueprintValidationError,
    );
  }
});

test("スケジュール Trigger は時刻と間隔の片方だけを受け付ける", () => {
  const daily = validateBlueprint({
    name: "asa",
    trigger: {
      type: "schedule",
      dailyTime: "09:00",
      timezone: "Asia/Tokyo",
      channelId: "111",
      template: "送信",
    },
    conditions: [],
    actions: [{ type: "sendToChannel", channelId: "111", template: "送信" }],
  });
  assert.equal(daily.trigger.type, "schedule");
  assert.throws(
    () =>
      validateBlueprint({
        name: "x",
        trigger: {
          type: "schedule",
          dailyTime: "09:00",
          intervalMinutes: 60,
          timezone: "Asia/Tokyo",
          channelId: "111",
          template: "送信",
        },
        conditions: [],
        actions: [
          { type: "sendToChannel", channelId: "111", template: "送信" },
        ],
      }),
    /exactly one of dailyTime or intervalMinutes/,
  );
  assert.throws(
    () =>
      validateBlueprint({
        name: "x",
        trigger: {
          type: "schedule",
          timezone: "Nowhere/Somewhere",
          intervalMinutes: 60,
          channelId: "111",
          template: "送信",
        },
        conditions: [],
        actions: [
          { type: "sendToChannel", channelId: "111", template: "送信" },
        ],
      }),
    /valid timezone/,
  );
});

test("未知のアクション種別として sendToChannel 以外は拒否される", () => {
  assert.throws(
    () =>
      validateBlueprint({
        name: "x",
        trigger: { type: "slash", command: "x" },
        conditions: [],
        actions: [{ type: "sendToDm", channelId: "1", template: "x" }],
      }),
    /Unknown action type: sendToDm/,
  );
});
