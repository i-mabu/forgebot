// =============================
// 1. Discord クライアントの基盤
// =============================

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { GRAPHITE, type Blueprint } from "./blueprint.js";
import {
  buildBlueprintFromForm,
  extractSimpleForm,
  MAX_COUNTER_KEY_LENGTH,
  MAX_TEMPLATE_LENGTH,
  renderBlueprintPreview,
  type BlueprintFormInput,
} from "./blueprintForm.js";
import {
  checkBlueprintCreation,
  checkBlueprintReplacement,
  createBlueprint,
  replaceBlueprint,
} from "./blueprintService.js";
import type { CooldownTracker } from "./cooldown.js";
import {
  buildDraftCustomId,
  DraftStore,
  isDraftOwner,
  parseDraftCustomId,
} from "./draft.js";
import { executeBlueprint } from "./engine.js";
import { hasManageGuild, MANAGE_GUILD_MISSING_MESSAGE } from "./permissions.js";
import { RenderError } from "./render.js";
import type { Store } from "./store.js";

export interface ClientDeps {
  store: Store;
  cooldowns: CooldownTracker;
  drafts: DraftStore;
  globalDisabled: boolean;
}

const MODAL_CREATE_ID = "forge:modal:create";
const MODAL_EDIT_PREFIX = "forge:modal:edit:";
const LIST_DISPLAY_LIMIT = 50;

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
    )
    .addSubcommand((sub) =>
      sub.setName("create").setDescription("Blueprint を作成する"),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Blueprint の一覧を表示する"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Blueprint を削除する")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Blueprint の名前")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Blueprint を編集する")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Blueprint の名前")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("data")
        .setDescription("サーバーのデータを管理する")
        .addSubcommand((sub) =>
          sub
            .setName("export")
            .setDescription("サーバーのデータを JSON で書き出す"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("サーバーのデータを全件削除する"),
        ),
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

// ===================
// 4. 権限の再チェック
// ===================

type GuildInteraction =
  ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction;

async function requireManageGuild(
  interaction: GuildInteraction,
): Promise<boolean> {
  if (hasManageGuild(interaction.memberPermissions)) return true;
  await interaction.reply({
    content: MANAGE_GUILD_MISSING_MESSAGE,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

// =========================
// 5. モーダルとボタンの構築
// =========================

function buildBlueprintModal(
  customId: string,
  title: string,
  initial?: BlueprintFormInput,
): ModalBuilder {
  const nameInput = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("コマンド名")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);
  if (initial !== undefined) nameInput.setValue(initial.name);
  const templateInput = new TextInputBuilder()
    .setCustomId("template")
    .setLabel("返信テンプレート")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(MAX_TEMPLATE_LENGTH)
    .setPlaceholder("{user} さん、訪問 {count:visits} 回目");
  if (initial !== undefined) templateInput.setValue(initial.template);
  const cooldownInput = new TextInputBuilder()
    .setCustomId("cooldown")
    .setLabel("クールダウン (秒、任意)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);
  if (initial !== undefined && initial.cooldown !== "") {
    cooldownInput.setValue(initial.cooldown);
  }
  const counterInput = new TextInputBuilder()
    .setCustomId("counter")
    .setLabel("カウンターキー (任意)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_COUNTER_KEY_LENGTH);
  if (initial !== undefined && initial.counterKey !== "") {
    counterInput.setValue(initial.counterKey);
  }
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(templateInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cooldownInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(counterInput),
    );
}

function buildDraftButtons(
  sessionId: string,
  confirmLabel: string,
  confirmStyle: ButtonStyle,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDraftCustomId("confirm", sessionId))
      .setLabel(confirmLabel)
      .setStyle(confirmStyle),
    new ButtonBuilder()
      .setCustomId(buildDraftCustomId("cancel", sessionId))
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ==========================
// 6. /forge の各サブコマンド
// ==========================

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;
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

async function handleCreate(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.showModal(
    buildBlueprintModal(MODAL_CREATE_ID, "Blueprint 作成"),
  );
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const blueprints = deps.store.listBlueprints(interaction.guildId ?? "");
  if (blueprints.length === 0) {
    await interaction.reply({
      content: "Blueprint: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = blueprints
    .slice(0, LIST_DISPLAY_LIMIT)
    .map((blueprint, index) => {
      const trigger =
        blueprint.trigger.type === "slash"
          ? "slash"
          : `event (${blueprint.trigger.event})`;
      return `${index + 1}. /${blueprint.name}: ${trigger}, アクション ${blueprint.actions.length} 件`;
    });
  if (blueprints.length > LIST_DISPLAY_LIMIT) {
    lines.push(`他 ${blueprints.length - LIST_DISPLAY_LIMIT} 件`);
  }
  await interaction.reply({
    content: [`Blueprint 一覧: ${blueprints.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDeleteCommand(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  if (deps.store.getBlueprint(guildId, name) === null) {
    await interaction.reply({
      content: `見つかりませんでした: /${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const session = deps.drafts.put(guildId, interaction.user.id, {
    kind: "delete",
    name,
  });
  await interaction.reply({
    content: `削除します: /${name}`,
    components: [buildDraftButtons(session.id, "確認", ButtonStyle.Danger)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEdit(
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
  const form = extractSimpleForm(blueprint);
  if (!form.ok) {
    await interaction.reply({
      content: form.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.showModal(
    buildBlueprintModal(
      `${MODAL_EDIT_PREFIX}${name}`,
      "Blueprint 編集",
      form.value,
    ),
  );
}

async function handleDataExport(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const data = deps.store.exportGuildData(guildId);
  const attachment = new AttachmentBuilder(
    Buffer.from(JSON.stringify(data, null, 2), "utf-8"),
    { name: `forge-export-${guildId}.json` },
  );
  await interaction.reply({
    content: "書き出しました: サーバーのデータ",
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDataDeleteCommand(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const session = deps.drafts.put(
    interaction.guildId ?? "",
    interaction.user.id,
    { kind: "dataDelete" },
  );
  await interaction.reply({
    content: "削除します: サーバーのデータ全件",
    components: [buildDraftButtons(session.id, "確認", ButtonStyle.Danger)],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================
// 7. モーダル送信の処理
// =====================

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: ClientDeps,
): Promise<void> {
  const isCreate = interaction.customId === MODAL_CREATE_ID;
  const isEdit = interaction.customId.startsWith(MODAL_EDIT_PREFIX);
  if (!isCreate && !isEdit) return;
  if (!(await requireManageGuild(interaction))) return;
  const guildId = interaction.guildId ?? "";
  const originalName = isEdit
    ? interaction.customId.slice(MODAL_EDIT_PREFIX.length)
    : null;
  const built = buildBlueprintFromForm({
    name: interaction.fields.getTextInputValue("name"),
    template: interaction.fields.getTextInputValue("template"),
    cooldown: interaction.fields.getTextInputValue("cooldown"),
    counterKey: interaction.fields.getTextInputValue("counter"),
  });
  if (!built.ok) {
    await interaction.reply({
      content: built.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const blueprint = built.value;
  const check =
    isEdit && originalName !== null
      ? checkBlueprintReplacement(deps.store, guildId, originalName, blueprint)
      : checkBlueprintCreation(deps.store, guildId, blueprint);
  if (!check.ok) {
    await interaction.reply({
      content: check.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let preview: string[];
  try {
    preview = renderBlueprintPreview(blueprint, {
      user: interaction.user.username,
      server: interaction.guild?.name ?? "",
      getCounter: (key) => deps.store.getCounter(guildId, key),
    });
  } catch (error) {
    if (error instanceof RenderError) {
      await interaction.reply({
        content:
          "プレビューを表示できませんでした。テンプレートのプレースホルダが不正です",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }
  const session = deps.drafts.put(
    guildId,
    interaction.user.id,
    isEdit && originalName !== null
      ? { kind: "edit", blueprint, originalName }
      : { kind: "create", blueprint },
  );
  await interaction.reply({
    content: [
      `Blueprint: /${blueprint.name}`,
      "Trigger: slash",
      `アクション: ${blueprint.actions.length} 件`,
      `クールダウン: ${blueprint.cooldownSeconds ?? 0} 秒`,
      "プレビュー:",
      preview.length > 0 ? preview.join("\n") : "(出力なし)",
    ].join("\n"),
    components: [buildDraftButtons(session.id, "保存", ButtonStyle.Primary)],
    flags: MessageFlags.Ephemeral,
  });
}

// ===================
// 8. 確認ボタンの処理
// ===================

async function handleDraftButton(
  interaction: ButtonInteraction,
  deps: ClientDeps,
): Promise<void> {
  const parsed = parseDraftCustomId(interaction.customId);
  if (parsed === null) return;
  const session = deps.drafts.get(parsed.id);
  if (session === null) {
    await interaction.reply({
      content: "見つかりませんでした。確認の有効期限が切れています",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId ?? "";
  if (!isDraftOwner(session, guildId, interaction.user.id)) {
    await interaction.reply({
      content: "実行できませんでした。作成者本人のみ操作できます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await requireManageGuild(interaction))) return;
  const taken = deps.drafts.take(parsed.id);
  if (taken === null) {
    await interaction.reply({
      content: "見つかりませんでした。確認の有効期限が切れています",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (parsed.action === "cancel") {
    await interaction.update({ content: "キャンセルしました", components: [] });
    return;
  }
  const data = taken.data;
  if (data.kind === "create") {
    const result = createBlueprint(deps.store, guildId, data.blueprint);
    await interaction.update({
      content: result.ok
        ? `作成しました: /${data.blueprint.name}`
        : result.message,
      components: [],
    });
    return;
  }
  if (data.kind === "edit") {
    const result = replaceBlueprint(
      deps.store,
      guildId,
      data.originalName,
      data.blueprint,
    );
    await interaction.update({
      content: result.ok
        ? `更新しました: /${data.blueprint.name}`
        : result.message,
      components: [],
    });
    return;
  }
  if (data.kind === "delete") {
    const deleted = deps.store.deleteBlueprint(guildId, data.name);
    await interaction.update({
      content: deleted
        ? `削除しました: /${data.name}`
        : `見つかりませんでした: /${data.name}`,
      components: [],
    });
    return;
  }
  deps.store.deleteGuildData(guildId);
  await interaction.update({
    content: "削除しました: サーバーのデータ全件",
    components: [],
  });
}

// ===========================
// 9. オートコンプリートの処理
// ===========================

async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (interaction.commandName !== "forge" || interaction.guildId === null) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = deps.store
    .listBlueprints(interaction.guildId)
    .map((blueprint) => blueprint.name)
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  await interaction.respond(choices);
}

// =================
// 10. /c による実行
// =================

async function handleRun(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint: Blueprint | null = deps.store.getBlueprint(guildId, name);
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

// ==============================
// 11. インタラクションの振り分け
// ==============================

export function attachHandlers(client: Client, deps: ClientDeps): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready: ${readyClient.user.tag}`);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, deps);
        return;
      }
      if (interaction.isModalSubmit()) {
        if (interaction.guildId === null) {
          await interaction.reply({
            content: "実行できませんでした。サーバー内で実行してください",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await handleModalSubmit(interaction, deps);
        return;
      }
      if (interaction.isButton()) {
        if (interaction.guildId === null) return;
        await handleDraftButton(interaction, deps);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.guildId === null) {
        await interaction.reply({
          content: "実行できませんでした。サーバー内で実行してください",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.commandName === "forge") {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();
        if (group === "data") {
          if (!(await requireManageGuild(interaction))) return;
          if (sub === "export") await handleDataExport(interaction, deps);
          if (sub === "delete") {
            await handleDataDeleteCommand(interaction, deps);
          }
          return;
        }
        if (sub === "status") {
          await handleStatus(interaction, deps);
          return;
        }
        if (!(await requireManageGuild(interaction))) return;
        if (sub === "create") await handleCreate(interaction);
        if (sub === "list") await handleList(interaction, deps);
        if (sub === "delete") await handleDeleteCommand(interaction, deps);
        if (sub === "edit") await handleEdit(interaction, deps);
        return;
      }
      if (interaction.commandName === "c") {
        await handleRun(interaction, deps);
      }
    } catch (error) {
      console.error("Interaction handling failed:", error);
      try {
        if (
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content: "実行できませんでした。内部でエラーが発生しました",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // 応答自体に失敗した場合は何もしない
      }
    }
  });
}
