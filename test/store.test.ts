import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBlueprint } from "../src/blueprint.js";
import { Store } from "../src/store.js";

function makeStore(): Store {
  return new Store(":memory:");
}

function sampleBlueprint(name: string) {
  return validateBlueprint({
    name,
    trigger: { type: "slash", command: name },
    conditions: [{ type: "always" }],
    actions: [{ type: "reply", template: "ok" }],
  });
}

test("blueprint はギルドごとに分離される", () => {
  const store = makeStore();
  store.upsertBlueprint("g1", sampleBlueprint("omikuji"));
  assert.equal(store.getBlueprint("g1", "omikuji")?.name, "omikuji");
  assert.equal(store.getBlueprint("g2", "omikuji"), null);
  assert.equal(store.listBlueprints("g2").length, 0);
  store.close();
});

test("同名 blueprint はギルドごとに独立して上書きされる", () => {
  const store = makeStore();
  store.upsertBlueprint("g1", sampleBlueprint("a"));
  store.upsertBlueprint("g2", sampleBlueprint("a"));
  assert.equal(store.deleteBlueprint("g1", "a"), true);
  assert.equal(store.getBlueprint("g1", "a"), null);
  assert.equal(store.getBlueprint("g2", "a")?.name, "a");
  store.close();
});

test("変数はギルドとスコープで分離される", () => {
  const store = makeStore();
  store.setVariable("g1", "user", "u1", "color", "red");
  assert.equal(store.getVariable("g1", "user", "u1", "color"), "red");
  assert.equal(store.getVariable("g2", "user", "u1", "color"), null);
  assert.equal(store.getVariable("g1", "user", "u2", "color"), null);
  assert.equal(store.getVariable("g1", "guild", "", "color"), null);
  store.close();
});

test("カウンターはギルドごとに加算される", () => {
  const store = makeStore();
  assert.equal(store.incrementCounter("g1", "visits"), 1);
  assert.equal(store.incrementCounter("g1", "visits", 4), 5);
  assert.equal(store.getCounter("g2", "visits"), 0);
  assert.equal(store.getCounter("g1", "visits"), 5);
  store.close();
});

test("ギルド無効化フラグを設定できる", () => {
  const store = makeStore();
  assert.equal(store.isGuildDisabled("g1"), false);
  store.setGuildDisabled("g1", true);
  assert.equal(store.isGuildDisabled("g1"), true);
  assert.equal(store.isGuildDisabled("g2"), false);
  store.setGuildDisabled("g1", false);
  assert.equal(store.isGuildDisabled("g1"), false);
  store.close();
});

test("exportGuildData は自ギルドのデータだけを返す", () => {
  const store = makeStore();
  store.upsertBlueprint("g1", sampleBlueprint("a"));
  store.upsertBlueprint("g2", sampleBlueprint("b"));
  store.setVariable("g1", "guild", "", "k", "v1");
  store.setVariable("g2", "guild", "", "k", "v2");
  store.incrementCounter("g1", "c", 3);
  const exported = store.exportGuildData("g1");
  assert.equal(exported.guildId, "g1");
  assert.deepEqual(
    exported.blueprints.map((b) => b.name),
    ["a"],
  );
  assert.deepEqual(exported.variables, [
    { scope: "guild", ownerId: "", key: "k", value: "v1" },
  ]);
  assert.deepEqual(exported.counters, [{ key: "c", value: 3 }]);
  store.close();
});

test("deleteGuildData は自ギルドのデータだけを消す", () => {
  const store = makeStore();
  store.upsertBlueprint("g1", sampleBlueprint("a"));
  store.upsertBlueprint("g2", sampleBlueprint("b"));
  store.setVariable("g1", "guild", "", "k", "v1");
  store.incrementCounter("g1", "c", 2);
  store.recordExecution("g1");
  store.deleteGuildData("g1");
  assert.equal(store.getBlueprint("g1", "a"), null);
  assert.equal(store.getVariable("g1", "guild", "", "k"), null);
  assert.equal(store.getCounter("g1", "c"), 0);
  assert.deepEqual(store.getCounts("g1"), {
    blueprints: 0,
    variables: 0,
    counters: 0,
    executions: 0,
  });
  assert.equal(store.getBlueprint("g2", "b")?.name, "b");
  store.close();
});

test("getCounts は件数と実行総数を返す", () => {
  const store = makeStore();
  store.upsertBlueprint("g1", sampleBlueprint("a"));
  store.setVariable("g1", "guild", "", "k", "v");
  store.incrementCounter("g1", "c");
  store.recordExecution("g1");
  store.recordExecution("g1");
  assert.deepEqual(store.getCounts("g1"), {
    blueprints: 1,
    variables: 1,
    counters: 1,
    executions: 2,
  });
  store.close();
});

test("close は冪等である", () => {
  const store = makeStore();
  store.close();
  store.close();
});
