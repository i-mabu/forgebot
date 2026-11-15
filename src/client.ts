// =============================
// 1. Discord クライアントの基盤
// =============================

import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { GRAPHITE } from "./blueprint.js";
import type { CooldownTracker } from "./cooldown.js";
import { executeBlueprint } from "./engine.js";
import type { Store } from "./store.js";

export interface ClientDeps {
  store: Store;
  cooldowns: CooldownTracker;
  globalDisabled: boolean;
}

// =====================
// 2. コマンド定義の構築
// =====================

export function buildCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const forge = new SlashCommandBuilder()
    .setName("forge")
    .setDescription("FORGE の管理コマンド")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Blueprint / Variable / Counter の件数を表示する"),
    );
  const run = new SlashCommandBuilder()
    .setName("c")
    .setDescription("カスタムコマンドを実行する")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Blueprint の名前")
        .setRequired(true),
    );
  return [forge.toJSON(), run.toJSON()];
}

// =====================
// 3. クライアントの生成
// =====================

// Privileged Intent は使用しない。Slash コマンドに必要な Guilds のみ。
export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

// =======================
// 4. インタラクション処理
// =======================

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const permissions = interaction.memberPermissions;
  if (
    permissions === null ||
    !permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "実行できませんでした。権限が不足しています: ManageGuild",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const counts = deps.store.getCounts(interaction.guildId ?? "");
  await interaction.reply({
    content: [
      `Blueprint: ${counts.blueprints}`,
      `Variable: ${counts.variables}`,
      `Counter: ${counts.counters}`,
      `実行総数: ${counts.executions}`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRun(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint = deps.store.getBlueprint(guildId, name);
  if (blueprint === null) {
    await interaction.reply({
      content: `見つかりませんでした: /${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const result = executeBlueprint(blueprint, deps, {
    guildId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    serverName: interaction.guild?.name ?? "",
  });
  if (result.status === "blocked") {
    const message =
      result.reason === "cooldown"
        ? `実行できませんでした。クールダウン中です: 残り ${Math.ceil(
            (result.remainingMs ?? 0) / 1000,
          )} 秒`
        : "実行できませんでした。FORGE は無効化されています";
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.status === "skipped" || result.outputs.length === 0) {
    await interaction.reply({
      content: "実行されませんでした。条件を満たしていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const text = result.outputs.join("\n");
  if (blueprint.presentation?.format === "embed") {
    const embed = new EmbedBuilder()
      .setDescription(text)
      .setColor(blueprint.presentation.color ?? GRAPHITE);
    await interaction.reply({ embeds: [embed] });
    return;
  }
  await interaction.reply({ content: text });
}

export function attachHandlers(client: Client, deps: ClientDeps): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready: ${readyClient.user.tag}`);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId === null) {
      await interaction.reply({
        content: "実行できませんでした。サーバー内で実行してください",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      if (interaction.commandName === "forge") {
        if (interaction.options.getSubcommand() === "status") {
          await handleStatus(interaction, deps);
        }
        return;
      }
      if (interaction.commandName === "c") {
        await handleRun(interaction, deps);
      }
    } catch (error) {
      console.error("Interaction handling failed:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "実行できませんでした。内部でエラーが発生しました",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });
}
