// =============================
// 1. Discord クライアントの基盤
// =============================

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type MessageReaction,
  type ModalSubmitInteraction,
  type PartialMessageReaction,
  type PartialUser,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
  type User,
} from "discord.js";
import {
  buildReactionBlueprint,
  buildScheduleBlueprint,
  extractAutomationForm,
  getAutomationChannelId,
  remapAutomationChannel,
  type AutomationForm,
  type ScheduleFormInput,
} from "./automationForm.js";
import { GRAPHITE, type Blueprint } from "./blueprint.js";
import {
  buildBlueprintFromForm,
  extractSimpleForm,
  MAX_COUNTER_KEY_LENGTH,
  MAX_TEMPLATE_LENGTH,
  renderBlueprintPreview,
  validateCommandName,
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
import { executeBlueprint, type IntendedAction } from "./engine.js";
import { getGalleryTemplate, listGalleryTemplates } from "./gallery.js";
import { computeGrowthStage } from "./growth.js";
import { validateMemoryProposal } from "./memory.js";
import { hasManageGuild, MANAGE_GUILD_MISSING_MESSAGE } from "./permissions.js";
import { createDefaultRegistry, type PluginRegistry } from "./plugins.js";
import { matchesReactionTrigger, reactionCountFor } from "./reactionTrigger.js";
import { RenderError } from "./render.js";
import { isScheduleDue } from "./schedule.js";
import {
  decodeShareCode,
  encodeShareCode,
  ShareCodeError,
} from "./shareCode.js";
import type { Store } from "./store.js";

export interface ClientDeps {
  store: Store;
  cooldowns: CooldownTracker;
  drafts: DraftStore;
  globalDisabled: boolean;
  plugins?: PluginRegistry;
}

const defaultPlugins: PluginRegistry = createDefaultRegistry();

function pluginsOf(deps: ClientDeps): PluginRegistry {
  return deps.plugins ?? defaultPlugins;
}

const MODAL_CREATE_ID = "forge:modal:create";
const MODAL_EDIT_PREFIX = "forge:modal:edit:";
const MODAL_AUTO_PREFIX = "forge:modal:auto:";
const MODAL_AUTO_EDIT_PREFIX = "forge:modal:autoedit:";
const MODAL_IMPORT_ID = "forge:modal:import";
const SELECT_AUTO_TYPE_ID = "forge:auto:type";
const SELECT_AUTO_CHANNEL_PREFIX = "forge:auto:channel:";
const SELECT_IMPORT_CHANNEL_PREFIX = "forge:import:channel:";
const LIST_DISPLAY_LIMIT = 50;
const SHARE_CODE_INLINE_LIMIT = 1800;
const SCHEDULER_INTERVAL_MS = 30_000;
const MAX_MESSAGE_LENGTH = 2000;

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
        .setName("auto")
        .setDescription("自動化を管理する")
        .addSubcommand((sub) =>
          sub.setName("create").setDescription("自動化を作成する"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("share")
        .setDescription("Blueprint の共有コードを表示する")
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
        .setName("import")
        .setDescription("共有コードから Blueprint を読み込む"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("memory")
        .setDescription("サーバーの記憶を管理する")
        .addSubcommand((sub) =>
          sub
            .setName("propose")
            .setDescription("記憶の候補を登録する")
            .addStringOption((o) =>
              o.setName("key").setDescription("キー").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("kind")
                .setDescription("種別")
                .setRequired(true)
                .addChoices(
                  { name: "名言", value: "quote" },
                  { name: "記念日", value: "anniversary" },
                  { name: "メモ", value: "note" },
                ),
            )
            .addStringOption((o) =>
              o.setName("content").setDescription("内容").setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("記憶の一覧を表示する")
            .addStringOption((o) =>
              o
                .setName("status")
                .setDescription("承認状態")
                .setRequired(false)
                .addChoices(
                  { name: "pending", value: "pending" },
                  { name: "approved", value: "approved" },
                  { name: "rejected", value: "rejected" },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("approve")
            .setDescription("記憶の候補を承認する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("reject")
            .setDescription("記憶の候補を却下する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("delete")
            .setDescription("記憶を削除する")
            .addStringOption((o) =>
              o
                .setName("key")
                .setDescription("キー")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("plugin")
        .setDescription("プラグインを管理する")
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("プラグインの一覧を表示する"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("enable")
            .setDescription("プラグインを有効化する")
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("プラグイン名")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("disable")
            .setDescription("プラグインを無効化する")
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("プラグイン名")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("template")
        .setDescription("公式テンプレートを使う")
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("テンプレートの一覧を表示する"),
        )
        .addSubcommand((sub) =>
          sub
            .setName("use")
            .setDescription("テンプレートを取り込む")
            .addStringOption((o) =>
              o
                .setName("id")
                .setDescription("テンプレート ID")
                .setRequired(true)
                .setAutocomplete(true),
            )
            .addStringOption((o) =>
              o
                .setName("name")
                .setDescription("新しい名前 (任意)")
                .setRequired(false),
            ),
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

// Privileged Intent は使用しない。Slash コマンドとリアクション検知に
// 必要な非 Privileged な Intent のみを使う。
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
  });
}

// ===================
// 4. 権限の再チェック
// ===================

type GuildInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

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

type AutomationTriggerType = "reaction" | "schedule";

function textInput(
  customId: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  initial?: string,
  placeholder?: string,
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (initial !== undefined && initial !== "") input.setValue(initial);
  if (placeholder !== undefined) input.setPlaceholder(placeholder);
  return input;
}

function buildAutoModal(
  customId: string,
  triggerType: AutomationTriggerType,
  initial?: AutomationForm,
): ModalBuilder {
  const nameInput = textInput(
    "name",
    "名前",
    TextInputStyle.Short,
    true,
    initial?.input.name,
  );
  nameInput.setMaxLength(32);
  const templateInput = textInput(
    "template",
    "送信テンプレート",
    TextInputStyle.Paragraph,
    true,
    initial?.input.template,
    "{messageUrl} が {reactionCount} 件のリアクションに達しました",
  );
  templateInput.setMaxLength(MAX_TEMPLATE_LENGTH);
  const rows: ActionRowBuilder<TextInputBuilder>[] = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
  ];
  if (triggerType === "reaction") {
    const reactionInitial =
      initial !== undefined && initial.kind === "reaction"
        ? initial.input
        : undefined;
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textInput(
          "emoji",
          "絵文字 (任意、空欄で全絵文字)",
          TextInputStyle.Short,
          false,
          reactionInitial?.emoji,
        ),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textInput(
          "threshold",
          "閾値 (リアクション数)",
          TextInputStyle.Short,
          true,
          reactionInitial?.threshold,
        ),
      ),
    );
  } else {
    const scheduleInitial =
      initial !== undefined && initial.kind === "schedule"
        ? initial.input
        : undefined;
    rows.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textInput(
          "dailyTime",
          "時刻 HH:MM (任意)",
          TextInputStyle.Short,
          false,
          scheduleInitial?.dailyTime,
          "09:00",
        ),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        textInput(
          "interval",
          "間隔 分 (任意)",
          TextInputStyle.Short,
          false,
          scheduleInitial?.intervalMinutes,
          "60",
        ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<TextInputBuilder>().addComponents(templateInput),
  );
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(
      triggerType === "reaction" ? "リアクション自動化" : "スケジュール自動化",
    )
    .addComponents(...rows);
}

function buildImportModal(): ModalBuilder {
  const codeInput = textInput(
    "code",
    "共有コード",
    TextInputStyle.Paragraph,
    true,
  );
  const nameInput = textInput(
    "newName",
    "新しい名前 (任意)",
    TextInputStyle.Short,
    false,
  );
  nameInput.setMaxLength(32);
  return new ModalBuilder()
    .setCustomId(MODAL_IMPORT_ID)
    .setTitle("共有コードの読み込み")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    );
}

function buildChannelSelectRow(
  customId: string,
): ActionRowBuilder<ChannelSelectMenuBuilder> {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("送信先チャンネル")
      .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function describeTrigger(blueprint: Blueprint): string {
  if (blueprint.trigger.type === "slash") return "slash";
  if (blueprint.trigger.type === "reaction") return "reaction";
  if (blueprint.trigger.type === "schedule") return "schedule";
  return `event (${blueprint.trigger.event})`;
}

function displayBlueprintName(blueprint: Blueprint): string {
  return blueprint.trigger.type === "slash"
    ? `/${blueprint.name}`
    : blueprint.name;
}

// ==========================
// 6. /forge の各サブコマンド
// ==========================

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;
  const guildId = interaction.guildId ?? "";
  const counts = deps.store.getCounts(guildId);
  const growthRecord = deps.store.getGrowthRecord(guildId);
  const growth = computeGrowthStage(
    growthRecord?.totalExecutions ?? counts.executions,
    growthRecord?.activeDays ?? 0,
  );
  await interaction.reply({
    content: [
      `Blueprint: ${counts.blueprints}`,
      `Variable: ${counts.variables}`,
      `Counter: ${counts.counters}`,
      `実行総数: ${counts.executions}`,
      `記憶: ${deps.store.countMemories(guildId, "approved")} 件 (候補 ${deps.store.countMemories(guildId, "pending")} 件)`,
      `親密度: 段階 ${growth.level} (${growth.label}) / 稼働 ${growth.activeDays} 日`,
      `プラグイン: ${deps.store.listPluginInstalls(guildId).filter((p) => p.enabled).length} 件有効`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

// ============================
// 6.1 記憶・プラグイン・テンプレート
// ============================

async function handleMemoryPropose(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const validated = validateMemoryProposal({
    key: interaction.options.getString("key", true),
    kind: interaction.options.getString("kind", true),
    content: interaction.options.getString("content", true),
  });
  if (!validated.ok) {
    await interaction.reply({
      content: `登録できませんでした。${validated.message}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const record = deps.store.proposeMemory(guildId, {
    ...validated.value,
    createdBy: interaction.user.id,
  });
  await interaction.reply({
    content: `候補を登録しました: ${record.key}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMemoryList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const statusRaw = interaction.options.getString("status");
  const status =
    statusRaw === "pending" ||
    statusRaw === "approved" ||
    statusRaw === "rejected"
      ? statusRaw
      : undefined;
  const memories = deps.store.listMemories(guildId, status);
  if (memories.length === 0) {
    await interaction.reply({
      content: "記憶: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = memories
    .slice(0, LIST_DISPLAY_LIMIT)
    .map((m, i) => `${i + 1}. ${m.key}: [${m.kind}/${m.status}] ${m.content}`);
  await interaction.reply({
    content: [`記憶一覧: ${memories.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMemoryApprove(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const ok = deps.store.approveMemory(guildId, key, interaction.user.id);
  await interaction.reply({
    content: ok ? `承認しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMemoryReject(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const ok = deps.store.rejectMemory(guildId, key);
  await interaction.reply({
    content: ok ? `却下しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMemoryDelete(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const key = interaction.options.getString("key", true).trim().toLowerCase();
  const ok = deps.store.deleteMemory(guildId, key);
  await interaction.reply({
    content: ok ? `削除しました: ${key}` : `見つかりませんでした: ${key}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePluginList(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const plugins = pluginsOf(deps).list();
  if (plugins.length === 0) {
    await interaction.reply({
      content: "プラグイン: 0 件",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = plugins.map((p, i) => {
    const enabled = deps.store.isPluginEnabled(guildId, p.manifest.name);
    const blocks = [
      ...p.manifest.provides.conditions.map((c) => `条件:${c}`),
      ...p.manifest.provides.actions.map((a) => `アクション:${a}`),
    ].join(", ");
    return `${i + 1}. ${p.manifest.name}: ${enabled ? "有効" : "無効"} (${blocks})`;
  });
  await interaction.reply({
    content: [`プラグイン一覧: ${plugins.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePluginSetEnabled(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
  enabled: boolean,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  if (pluginsOf(deps).get(name) === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  deps.store.setPluginEnabled(guildId, name, enabled);
  await interaction.reply({
    content: enabled ? `有効化しました: ${name}` : `無効化しました: ${name}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTemplateList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const templates = listGalleryTemplates();
  const lines = templates.map(
    (t, i) => `${i + 1}. ${t.id}: ${t.name} - ${t.description}`,
  );
  await interaction.reply({
    content: [`テンプレート一覧: ${templates.length} 件`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTemplateUse(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const id = interaction.options.getString("id", true);
  const template = getGalleryTemplate(id);
  if (template === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${id}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const newNameRaw = interaction.options.getString("name");
  let blueprint: Blueprint = template.blueprint;
  if (newNameRaw !== null && newNameRaw.trim() !== "") {
    const validated = validateCommandName(newNameRaw);
    if (!validated.ok) {
      await interaction.reply({
        content: validated.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    blueprint = {
      ...blueprint,
      name: validated.value,
      trigger:
        blueprint.trigger.type === "slash"
          ? { type: "slash", command: validated.value }
          : blueprint.trigger,
    };
  }
  if (getAutomationChannelId(blueprint) !== null) {
    const session = deps.drafts.put(guildId, interaction.user.id, {
      kind: "importChannel",
      blueprint,
    });
    await interaction.reply({
      content: `送信先チャンネルを選択してください: ${blueprint.name}`,
      components: [
        buildChannelSelectRow(`${SELECT_IMPORT_CHANNEL_PREFIX}${session.id}`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // ChatInput からは presentBlueprintDraft の対象型に合わないため、
  // プレビューなしで直接保存せず、共有コード取り込みと同じ確認経路を
  // 使えない場合は保存前にチェックだけ行い下書きボタンを提示する。
  const check = checkBlueprintCreation(deps.store, guildId, blueprint);
  if (!check.ok) {
    await interaction.reply({
      content: check.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const session = deps.drafts.put(guildId, interaction.user.id, {
    kind: "create",
    blueprint,
  });
  await interaction.reply({
    content: `テンプレート: ${template.id} (${blueprint.name})`,
    components: [buildDraftButtons(session.id, "保存", ButtonStyle.Primary)],
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
      return `${index + 1}. ${displayBlueprintName(blueprint)}: ${describeTrigger(blueprint)}, アクション ${blueprint.actions.length} 件`;
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
  if (
    blueprint.trigger.type === "reaction" ||
    blueprint.trigger.type === "schedule"
  ) {
    const form = extractAutomationForm(blueprint);
    if (!form.ok) {
      await interaction.reply({
        content: form.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(
      buildAutoModal(
        `${MODAL_AUTO_EDIT_PREFIX}${name}`,
        blueprint.trigger.type,
        form.value,
      ),
    );
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

async function handleAutoCreateStart(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_AUTO_TYPE_ID)
    .setPlaceholder("Trigger の種別")
    .addOptions(
      {
        label: "リアクション",
        value: "reaction",
        description: "リアクション数が閾値に達したら送信する",
      },
      {
        label: "スケジュール",
        value: "schedule",
        description: "時刻または間隔で送信する",
      },
    );
  await interaction.reply({
    content: "Trigger の種別を選択してください",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleShare(
  interaction: ChatInputCommandInteraction,
  deps: ClientDeps,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const name = interaction.options.getString("name", true);
  const blueprint = deps.store.getBlueprint(guildId, name);
  if (blueprint === null) {
    await interaction.reply({
      content: `見つかりませんでした: ${name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const code = encodeShareCode(blueprint);
  if (code.length <= SHARE_CODE_INLINE_LIMIT) {
    await interaction.reply({
      content: [`共有コード: ${blueprint.name}`, "```", code, "```"].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const attachment = new AttachmentBuilder(Buffer.from(code, "utf-8"), {
    name: `forge-share-${blueprint.name}.txt`,
  });
  await interaction.reply({
    content: `共有コード: ${blueprint.name} (ファイル添付)`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleImportCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.showModal(buildImportModal());
}

// ===================
// 7. プレビューの提示
// ===================

type PreviewInteraction = ModalSubmitInteraction | ChannelSelectMenuInteraction;

// 保存前のプレビューと保存 / キャンセルボタンを提示する。
// 保存するまでストアには書き込まない。
async function presentBlueprintDraft(
  interaction: PreviewInteraction,
  deps: ClientDeps,
  blueprint: Blueprint,
  originalName: string | null,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const check =
    originalName !== null
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
      messageUrl: "(メッセージ URL)",
      reactionCount:
        blueprint.trigger.type === "reaction" ? blueprint.trigger.threshold : 0,
      getCounter: (key) => deps.store.getCounter(guildId, key),
      getMemory: (key) => deps.store.getApprovedMemory(guildId, key),
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
    originalName !== null
      ? { kind: "edit", blueprint, originalName }
      : { kind: "create", blueprint },
  );
  await interaction.reply({
    content: [
      `Blueprint: ${displayBlueprintName(blueprint)}`,
      `Trigger: ${describeTrigger(blueprint)}`,
      `アクション: ${blueprint.actions.length} 件`,
      `クールダウン: ${blueprint.cooldownSeconds ?? 0} 秒`,
      "プレビュー:",
      preview.length > 0 ? preview.join("\n") : "(出力なし)",
    ].join("\n"),
    components: [buildDraftButtons(session.id, "保存", ButtonStyle.Primary)],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================
// 8. モーダル送信の処理
// =====================

function buildAutoBlueprintFromModal(
  interaction: ModalSubmitInteraction,
  triggerType: AutomationTriggerType,
  channelId: string,
  timezone?: string,
): ReturnType<typeof buildReactionBlueprint> {
  if (triggerType === "reaction") {
    return buildReactionBlueprint({
      name: interaction.fields.getTextInputValue("name"),
      emoji: interaction.fields.getTextInputValue("emoji"),
      threshold: interaction.fields.getTextInputValue("threshold"),
      channelId,
      template: interaction.fields.getTextInputValue("template"),
    });
  }
  const input: ScheduleFormInput = {
    name: interaction.fields.getTextInputValue("name"),
    dailyTime: interaction.fields.getTextInputValue("dailyTime"),
    intervalMinutes: interaction.fields.getTextInputValue("interval"),
    channelId,
    template: interaction.fields.getTextInputValue("template"),
  };
  if (timezone !== undefined) input.timezone = timezone;
  return buildScheduleBlueprint(input);
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  deps: ClientDeps,
): Promise<void> {
  const customId = interaction.customId;
  const isCreate = customId === MODAL_CREATE_ID;
  const isEdit = customId.startsWith(MODAL_EDIT_PREFIX);
  const isAuto = customId.startsWith(MODAL_AUTO_PREFIX);
  const isAutoEdit = customId.startsWith(MODAL_AUTO_EDIT_PREFIX);
  const isImport = customId === MODAL_IMPORT_ID;
  if (!isCreate && !isEdit && !isAuto && !isAutoEdit && !isImport) return;
  if (!(await requireManageGuild(interaction))) return;
  const guildId = interaction.guildId ?? "";

  if (isImport) {
    let blueprint: Blueprint;
    try {
      blueprint = decodeShareCode(interaction.fields.getTextInputValue("code"));
    } catch (error) {
      if (error instanceof ShareCodeError) {
        await interaction.reply({
          content: error.message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      throw error;
    }
    const newName = interaction.fields.getTextInputValue("newName").trim();
    if (newName !== "") {
      const validated = validateCommandName(newName);
      if (!validated.ok) {
        await interaction.reply({
          content: validated.message,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      blueprint = {
        ...blueprint,
        name: validated.value,
        trigger:
          blueprint.trigger.type === "slash"
            ? { type: "slash", command: validated.value }
            : blueprint.trigger,
      };
    }
    if (getAutomationChannelId(blueprint) !== null) {
      const session = deps.drafts.put(guildId, interaction.user.id, {
        kind: "importChannel",
        blueprint,
      });
      await interaction.reply({
        content: `送信先チャンネルを選択してください: ${blueprint.name}`,
        components: [
          buildChannelSelectRow(`${SELECT_IMPORT_CHANNEL_PREFIX}${session.id}`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await presentBlueprintDraft(interaction, deps, blueprint, null);
    return;
  }

  if (isAuto || isAutoEdit) {
    let triggerType: AutomationTriggerType;
    let channelId: string;
    let originalName: string | null = null;
    let timezone: string | undefined;
    if (isAuto) {
      const rest = customId.slice(MODAL_AUTO_PREFIX.length);
      const separator = rest.indexOf(":");
      triggerType = rest.slice(0, separator) as AutomationTriggerType;
      channelId = rest.slice(separator + 1);
    } else {
      originalName = customId.slice(MODAL_AUTO_EDIT_PREFIX.length);
      const existing = deps.store.getBlueprint(guildId, originalName);
      if (
        existing === null ||
        (existing.trigger.type !== "reaction" &&
          existing.trigger.type !== "schedule")
      ) {
        await interaction.reply({
          content: `見つかりませんでした: ${originalName}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      triggerType = existing.trigger.type;
      channelId = existing.trigger.channelId;
      if (existing.trigger.type === "schedule") {
        timezone = existing.trigger.timezone;
      }
    }
    const built = buildAutoBlueprintFromModal(
      interaction,
      triggerType,
      channelId,
      timezone,
    );
    if (!built.ok) {
      await interaction.reply({
        content: built.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await presentBlueprintDraft(interaction, deps, built.value, originalName);
    return;
  }

  const originalName = isEdit ? customId.slice(MODAL_EDIT_PREFIX.length) : null;
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
  await presentBlueprintDraft(interaction, deps, built.value, originalName);
}

// =====================
// 9. 選択メニューの処理
// =====================

async function handleStringSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId !== SELECT_AUTO_TYPE_ID) return;
  if (!(await requireManageGuild(interaction))) return;
  const value = interaction.values[0];
  if (value !== "reaction" && value !== "schedule") return;
  await interaction.update({
    content: "送信先チャンネルを選択してください",
    components: [
      buildChannelSelectRow(`${SELECT_AUTO_CHANNEL_PREFIX}${value}`),
    ],
  });
}

async function handleChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  deps: ClientDeps,
): Promise<void> {
  const customId = interaction.customId;
  if (customId.startsWith(SELECT_AUTO_CHANNEL_PREFIX)) {
    if (!(await requireManageGuild(interaction))) return;
    const triggerType = customId.slice(
      SELECT_AUTO_CHANNEL_PREFIX.length,
    ) as AutomationTriggerType;
    const channelId = interaction.values[0];
    if (channelId === undefined) return;
    await interaction.showModal(
      buildAutoModal(
        `${MODAL_AUTO_PREFIX}${triggerType}:${channelId}`,
        triggerType,
      ),
    );
    return;
  }
  if (customId.startsWith(SELECT_IMPORT_CHANNEL_PREFIX)) {
    const draftId = customId.slice(SELECT_IMPORT_CHANNEL_PREFIX.length);
    const session = deps.drafts.get(draftId);
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
    const taken = deps.drafts.take(draftId);
    if (taken === null || taken.data.kind !== "importChannel") {
      await interaction.reply({
        content: "見つかりませんでした。確認の有効期限が切れています",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channelId = interaction.values[0];
    if (channelId === undefined) return;
    const remapped = remapAutomationChannel(taken.data.blueprint, channelId);
    await presentBlueprintDraft(interaction, deps, remapped, null);
  }
}

// ====================
// 10. 確認ボタンの処理
// ====================

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
  if (data.kind === "importChannel") {
    await interaction.update({
      content: "実行できませんでした。送信先チャンネルが選択されていません",
      components: [],
    });
    return;
  }
  if (data.kind === "dataDelete") {
    deps.store.deleteGuildData(guildId);
    await interaction.update({
      content: "削除しました: サーバーのデータ全件",
      components: [],
    });
    return;
  }
  // 未知の draft 種別はデータを変更せずエラー表示で終わる。
  // 将来種別を追加したときに、誤ってデータ全件削除へ
  // フォールスルーしないためのデフォルト分岐。
  await interaction.update({
    content: "実行できませんでした。不明な確認種別です",
    components: [],
  });
}

// ============================
// 11. オートコンプリートの処理
// ============================

async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  deps: ClientDeps,
): Promise<void> {
  if (interaction.commandName !== "forge" || interaction.guildId === null) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  let group: string | null = null;
  let sub: string | null = null;
  try {
    group = interaction.options.getSubcommandGroup(false);
    sub = interaction.options.getSubcommand(false);
  } catch {
    group = null;
    sub = null;
  }
  let candidates: string[];
  if (group === "memory") {
    candidates = deps.store.listMemories(interaction.guildId).map((m) => m.key);
  } else if (group === "plugin") {
    candidates = pluginsOf(deps)
      .list()
      .map((p) => p.manifest.name);
  } else if (group === "template" && sub === "use") {
    candidates = listGalleryTemplates().map((t) => t.id);
  } else {
    candidates = deps.store
      .listBlueprints(interaction.guildId)
      .map((blueprint) => blueprint.name);
  }
  const choices = candidates
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  await interaction.respond(choices);
}

// =================
// 12. /c による実行
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
  const result = executeBlueprint(
    blueprint,
    { ...deps, plugins: pluginsOf(deps) },
    {
      guildId,
      userId: interaction.user.id,
      userName: interaction.user.username,
      serverName: interaction.guild?.name ?? "",
    },
  );
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
  if (result.status === "skipped") {
    await interaction.reply({
      content: "実行されませんでした。条件を満たしていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // /forge run が実行するのは返信アクションだけ。チャンネル送信
  // アクションは実行されないため、黙って捨てず返信で知らせる。
  const channelNote = result.actions.some(
    (action) => action.type === "sendToChannel",
  )
    ? "※ チャンネルへの送信は /forge run では実行されません"
    : null;
  if (result.outputs.length === 0) {
    await interaction.reply({
      content: channelNote ?? "実行されませんでした。条件を満たしていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const text = result.outputs.join("\n");
  if (blueprint.presentation?.format === "embed") {
    const embed = new EmbedBuilder()
      .setDescription(text)
      .setColor(blueprint.presentation.color ?? GRAPHITE);
    await interaction.reply({
      ...(channelNote !== null ? { content: channelNote } : {}),
      embeds: [embed],
    });
    return;
  }
  await interaction.reply({
    content: channelNote !== null ? `${text}\n${channelNote}` : text,
  });
}

// ======================
// 13. チャンネルへの送信
// ======================

type SendToChannelAction = Extract<IntendedAction, { type: "sendToChannel" }>;

// 送信先チャンネルの権限を確認してから送信する。
// 送信できない場合は警告ログを出して false を返す。
async function deliverToChannel(
  client: Client,
  guildId: string,
  blueprint: Blueprint,
  action: SendToChannelAction,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(action.channelId);
    if (
      channel === null ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      !("send" in channel)
    ) {
      console.warn(
        `Skipped send: channel ${action.channelId} is not a guild text channel`,
      );
      return false;
    }
    if (channel.guildId !== guildId) {
      console.warn(
        `Skipped send: channel ${action.channelId} is not in guild ${guildId}`,
      );
      return false;
    }
    const me =
      channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    if (
      permissions === null ||
      !permissions.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ])
    ) {
      console.warn(
        `Skipped send: missing ViewChannel/SendMessages in channel ${action.channelId}`,
      );
      return false;
    }
    const text = action.text.slice(0, MAX_MESSAGE_LENGTH);
    if (blueprint.presentation?.format === "embed") {
      const embed = new EmbedBuilder()
        .setDescription(text)
        .setColor(blueprint.presentation.color ?? GRAPHITE);
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send({ content: text });
    }
    return true;
  } catch (error) {
    console.warn(`Failed to send to channel ${action.channelId}:`, error);
    return false;
  }
}

// ===============================
// 14. リアクション Trigger の処理
// ===============================

async function handleReactionAdd(
  client: Client,
  deps: ClientDeps,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  try {
    const fullUser = user.partial ? await user.fetch() : user;
    if (fullUser.bot) return;
    if (deps.globalDisabled) return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    const guild = message.guild;
    if (guild === null) return;
    const guildId = guild.id;
    if (deps.store.isGuildDisabled(guildId)) return;
    const blueprints = deps.store.listBlueprintsByTriggerType(
      guildId,
      "reaction",
    );
    if (blueprints.length === 0) return;
    const author = message.author;
    if (author === null) return;
    const emojiCounts: Record<string, number> = {};
    let totalCount = 0;
    // 同じ件数を文字列表現・名前・ID の全キーで登録する。
    // Trigger 側の絵文字指定がどの表記でも一致するようにするため。
    for (const entry of message.reactions.cache.values()) {
      const count = entry.count ?? 0;
      totalCount += count;
      const keys = new Set<string>();
      keys.add(entry.emoji.toString());
      if (entry.emoji.name !== null) keys.add(entry.emoji.name);
      if (entry.emoji.id !== null) keys.add(entry.emoji.id);
      for (const key of keys) {
        if (key !== "") emojiCounts[key] = count;
      }
    }
    for (const blueprint of blueprints) {
      if (blueprint.trigger.type !== "reaction") continue;
      const trigger = blueprint.trigger;
      const input = {
        emojiCounts,
        totalCount,
        alreadyFired: deps.store.hasAutomationFired(
          guildId,
          blueprint.name,
          message.id,
        ),
      };
      if (!matchesReactionTrigger(trigger, input)) continue;
      const result = executeBlueprint(
        blueprint,
        { ...deps, plugins: pluginsOf(deps) },
        {
          guildId,
          userId: author.id,
          userName: author.username,
          serverName: guild.name,
          messageUrl: message.url,
          reactionCount: reactionCountFor(trigger, input),
        },
      );
      if (result.status !== "ok") continue;
      // 送信前に発火を記録して先取りする。同時に届いたリアクションで
      // 二重に送信しないよう、記録できなかった場合はここで止める。
      // 照合（hasAutomationFired）→実行→記録の間に await は無く
      // 同期的に完了するため、カウンターや変数といった送信以外の
      // 副作用も二重に適用されることはない。
      if (
        !deps.store.markAutomationFired(guildId, blueprint.name, message.id)
      ) {
        continue;
      }
      for (const action of result.actions) {
        if (action.type === "sendToChannel") {
          await deliverToChannel(client, guildId, blueprint, action);
        }
      }
    }
  } catch (error) {
    console.error("Reaction handling failed:", error);
  }
}

// ================
// 15. スケジューラ
// ================

export interface SchedulerHandle {
  stop: () => void;
}

export function startScheduler(
  client: Client,
  deps: ClientDeps,
): SchedulerHandle {
  // 前回の tick が終わっていない間は重ねて実行しないためのガード。
  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      if (deps.globalDisabled) return;
      const now = new Date();
      for (const {
        guildId,
        blueprint,
      } of deps.store.listScheduledBlueprints()) {
        if (blueprint.trigger.type !== "schedule") continue;
        if (deps.store.isGuildDisabled(guildId)) continue;
        const lastRun = deps.store.getAutomationLastRun(
          guildId,
          blueprint.name,
        );
        if (!isScheduleDue(blueprint.trigger, lastRun, now)) continue;
        const guild = client.guilds.cache.get(guildId);
        if (guild === undefined) continue;
        const result = executeBlueprint(
          blueprint,
          { ...deps, plugins: pluginsOf(deps) },
          {
            guildId,
            userId: "",
            userName: client.user?.username ?? "FORGE",
            serverName: guild.name,
          },
        );
        if (result.status !== "ok") continue;
        // 送信より先に最終実行時刻を記録する。送信の成否にかかわらず、
        // 次回の tick や再起動で同じ回を二重に発火させないため。
        deps.store.setAutomationLastRun(guildId, blueprint.name, now);
        for (const action of result.actions) {
          if (action.type === "sendToChannel") {
            await deliverToChannel(client, guildId, blueprint, action);
          }
        }
      }
    } catch (error) {
      console.error("Scheduler tick failed:", error);
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, SCHEDULER_INTERVAL_MS);
  // タイマーだけでプロセスを生存させないよう参照を外す。
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}

// ==============================
// 16. インタラクションの振り分け
// ==============================

export function attachHandlers(
  client: Client,
  deps: ClientDeps,
): SchedulerHandle {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready: ${readyClient.user.tag}`);
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void handleReactionAdd(client, deps, reaction, user);
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
      if (interaction.isStringSelectMenu()) {
        if (interaction.guildId === null) return;
        await handleStringSelect(interaction);
        return;
      }
      if (interaction.isChannelSelectMenu()) {
        if (interaction.guildId === null) return;
        await handleChannelSelect(interaction, deps);
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
        if (group === "memory") {
          if (!(await requireManageGuild(interaction))) return;
          if (sub === "propose") await handleMemoryPropose(interaction, deps);
          if (sub === "list") await handleMemoryList(interaction, deps);
          if (sub === "approve") await handleMemoryApprove(interaction, deps);
          if (sub === "reject") await handleMemoryReject(interaction, deps);
          if (sub === "delete") await handleMemoryDelete(interaction, deps);
          return;
        }
        if (group === "plugin") {
          if (!(await requireManageGuild(interaction))) return;
          if (sub === "list") await handlePluginList(interaction, deps);
          if (sub === "enable") {
            await handlePluginSetEnabled(interaction, deps, true);
          }
          if (sub === "disable") {
            await handlePluginSetEnabled(interaction, deps, false);
          }
          return;
        }
        if (group === "template") {
          if (!(await requireManageGuild(interaction))) return;
          if (sub === "list") await handleTemplateList(interaction);
          if (sub === "use") await handleTemplateUse(interaction, deps);
          return;
        }
        if (sub === "status") {
          await handleStatus(interaction, deps);
          return;
        }
        if (!(await requireManageGuild(interaction))) return;
        if (group === "auto") {
          if (sub === "create") await handleAutoCreateStart(interaction);
          return;
        }
        if (sub === "create") await handleCreate(interaction);
        if (sub === "list") await handleList(interaction, deps);
        if (sub === "delete") await handleDeleteCommand(interaction, deps);
        if (sub === "edit") await handleEdit(interaction, deps);
        if (sub === "share") await handleShare(interaction, deps);
        if (sub === "import") await handleImportCommand(interaction);
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
  return startScheduler(client, deps);
}
