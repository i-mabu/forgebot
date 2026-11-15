import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { hasManageGuild } from "../src/permissions.js";

test("ManageGuild を持つ権限は通る", () => {
  const permissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
  assert.equal(hasManageGuild(permissions), true);
});

test("ManageGuild を持たない権限は通らない", () => {
  const permissions = new PermissionsBitField(PermissionFlagsBits.SendMessages);
  assert.equal(hasManageGuild(permissions), false);
});

test("権限が null なら通らない", () => {
  assert.equal(hasManageGuild(null), false);
  assert.equal(hasManageGuild(undefined), false);
});
