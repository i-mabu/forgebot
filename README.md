# FORGE

ユーザーが自分でコマンドと自動化を作れる、公開前提の Discord Bot。
Phase 2 はイベント Trigger の実行系と共有コードを実装している。

## 概要

FORGE の核は **Blueprint** という単一のデータ形式である。

```
Blueprint = Trigger + Conditions + Actions + Presentation
```

- カスタムコマンドは、Trigger が Slash の Blueprint である
- 自動化は、Trigger がリアクション / スケジュールの Blueprint である
- 開発者プラグインは、将来、新しいブロック種別を追加する形で統合する

FORGE 本体は人格を持たない道具である。口調の演出はせず、表示形式
（色・接頭辞・Embed 形式）だけを Presentation として扱う。

## セットアップ

必要環境: Node.js 22 以上。

```sh
npm install
cp .env.example .env   # DISCORD_TOKEN と DISCORD_CLIENT_ID を入力する
npm run register       # 開発用ギルドへ /forge と /c を登録する（DISCORD_GUILD_ID が必要）
npm run build
npm start
```

主な環境変数:

| 変数                | 内容                                       |
| ------------------- | ------------------------------------------ |
| `DISCORD_TOKEN`     | Bot のトークン（必須）                     |
| `DISCORD_CLIENT_ID` | アプリケーションの Client ID（必須）       |
| `DISCORD_GUILD_ID`  | コマンド登録先の開発用ギルド ID            |
| `FORGE_DISABLED`    | `1` / `true` で全ギルドの実行を停止する    |
| `FORGE_DB_PATH`     | SQLite のパス（既定: `data/forge.sqlite`） |

## コマンド

管理コマンドはすべてハンドラ側で `ManageGuild` 権限を再チェックし、
DM では実行できない。

- `/forge status` — Blueprint / Variable / Counter の件数と実行総数を
  数字のみで表示する
- `/forge create` — モーダルで Blueprint を作成する（下記）
- `/forge list` — そのギルドの Blueprint の一覧（名前・Trigger・
  アクション数）を表示する。自動化も Trigger 種別つきで含まれる
- `/forge auto create` — 自動化を作成する（下記）
- `/forge share <name>` — Blueprint の共有コードを表示する（下記）。
  名前の補完候補が出る
- `/forge import` — 共有コードから Blueprint を読み込む（下記）
- `/forge edit <name>` — 作成フォームで扱える形の Blueprint を、
  入力済みのモーダルで編集する。自動化は送信先チャンネルを据え置いて
  編集する。名前の補完候補が出る
- `/forge delete <name>` — 確認ボタンの後に Blueprint を削除する。
  自動化も削除できる。名前の補完候補が出る
- `/forge data export` — そのギルドのデータ（Blueprint・変数・
  カウンター）を JSON ファイルで書き出す
- `/forge data delete` — 確認ボタンの後に、そのギルドのデータを
  全件削除する
- `/c <name>` — そのギルドの Blueprint を名前で引いて実行する

## Blueprint の作成

`/forge create` でモーダルが開く。入力項目は次の4つ。

| 項目               | 内容                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| コマンド名         | 1〜32 文字。小文字の文字・数字・ハイフン・アンダースコア（日本語可）          |
| 返信テンプレート   | `{user}` `{server}` `{count:キー}` `{random:1-100}` `{choice:A,B}` 等が使える |
| クールダウン（秒） | 任意。0〜86400 の整数                                                         |
| カウンターキー     | 任意。指定すると実行のたびにそのカウンターを +1 してから描画する              |

送信すると、保存前に描画プレビュー（カウンターは加算後の値で表示、
実データは変更しない）と「保存 / キャンセル」ボタンが出る。
保存した時点で初めてストアに書き込まれる。確認待ちの状態は
10 分で失効し、作成した本人以外はボタンを操作できない。
ギルドごとの Blueprint 上限は 100 件。

## 自動化

`/forge auto create` で、Trigger 種別の選択 → 送信先チャンネルの
選択 → モーダルの順に作成する。保存の流れは Blueprint 作成と同じ
（プレビュー → 保存 / キャンセル）。

| Trigger      | 内容                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| リアクション | メッセージのリアクション数が閾値に達したら、送信先チャンネルへテンプレートを送信する。絵文字を指定するとその絵文字の数、空欄なら合計で判定する。メッセージごとに1回だけ発火する |
| スケジュール | 時刻（HH:MM、タイムゾーン付き）または間隔（分）ごとに、送信先チャンネルへテンプレートを送信する。最終実行時刻を保存し、再起動で二重に発火しない                                 |

自動化のテンプレートでは `{user}` `{server}` に加えて
`{messageUrl}`（発火したメッセージの URL）と `{reactionCount}`
（判定に使ったリアクション数）が使える。

参加 Trigger（メンバー参加時）は実装していない。`GuildMemberAdd` の
検知には Privileged Intent の `GuildMembers` が必要で、FORGE は
Privileged Intent を使用しない方針のため見送っている。

## 共有コード

`/forge share <name>` で Blueprint を共有コードとして表示する。

```
FORGE1-<チェックサム>-<gzip 圧縮した JSON の base64url>
```

チェックサムはペイロードの SHA-256 先頭8桁で、改ざんされたコードは
読み込み時に拒否される。コードが長い場合は `.txt` ファイルで添付する。

`/forge import` で共有コードを読み込む。任意で新しい名前を指定できる。
自動化の Blueprint に含まれる送信先チャンネル ID はそのまま使わず、
読み込み時に読み込み先ギルドのチャンネルを選択し直す（付け替えは
必須）。Slash の Blueprint はそのままプレビュー → 保存の流れになる。

## 設計の要約

- データは SQLite（Node 標準の `node:sqlite`）に保存し、全テーブルが
  `guild_id` を持つ。ギルド間のデータ分離をテストで保証している
- ストア層に `exportGuildData` / `deleteGuildData` を用意し、導入ギルドの
  管理者が自分のサーバーのデータを書き出し・全削除できる
- 実行前には全局停止スイッチ（`FORGE_DISABLED`）とギルド単位の無効化
  フラグを必ず確認する。Blueprint ごとにクールダウンも適用できる
- **Privileged Intent は使用しない。** クライアントの Intent は
  `Guilds` / `GuildMessages` / `GuildMessageReactions` のみで、
  いずれも非 Privileged な範囲に限定している。メッセージ本文は
  必要としない（リアクションの件数とメッセージ URL だけを使う）

## 声のルール（要約）

- 一人称を使わない。感情を表さない。挨拶をしない
- 文は短く、1 メッセージ 1 事実。絵文字は使わない
- Embed の色はグラファイト `#3A3F4A` で固定する
- 成功は作ったものを、失敗は不足しているものを具体名で伝える
  （例: `作成しました: /{name}`、
  `実行できませんでした。権限が不足しています: {permission}`）

## 開発

```sh
npm test          # node:test による単体テスト
npm run typecheck # 型チェック
npm run format    # Prettier で整形
```

整形フックを使う場合は `git config core.hooksPath .githooks` を設定する。

## まだ実装していないもの

- 参加 Trigger（Privileged Intent が必要なため見送り。上記参照）
- 記憶の候補 → 承認フローと、親密度などの成長まわり
- プラグインローダー
- 利用規約・プライバシーポリシーは `docs/legal/` に下書きがある
