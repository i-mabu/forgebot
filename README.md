# FORGE

ユーザーが自分でコマンドと自動化を作れる、公開前提の Discord Bot。
Phase 1 は土台のみを実装している。

## 概要

FORGE の核は **Blueprint** という単一のデータ形式である。

```
Blueprint = Trigger + Conditions + Actions + Presentation
```

- カスタムコマンドは、Trigger が Slash の Blueprint である
- 自動化は、Trigger がイベントの Blueprint である（Phase 2 で実装）
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

- `/forge status` — Blueprint / Variable / Counter の件数と実行総数を
  数字のみで表示する。ハンドラ側で `ManageGuild` 権限を再チェックする
- `/c <name>` — そのギルドの Blueprint を名前で引いて実行する

## 設計の要約

- データは SQLite（Node 標準の `node:sqlite`）に保存し、全テーブルが
  `guild_id` を持つ。ギルド間のデータ分離をテストで保証している
- ストア層に `exportGuildData` / `deleteGuildData` を用意し、導入ギルドの
  管理者が自分のサーバーのデータを書き出し・全削除できる
- 実行前には全局停止スイッチ（`FORGE_DISABLED`）とギルド単位の無効化
  フラグを必ず確認する。Blueprint ごとにクールダウンも適用できる
- **Privileged Intent は使用しない。** クライアントの Intent は
  `Guilds` のみで、Slash コマンドに必要な範囲に限定している

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

- Blueprint の作成 UI フロー（モーダル / ボタン）
- イベント Trigger（参加・リアクション・定期実行）
- 共有コードの書き出し / 読み込み
- プラグインローダー
- 利用規約・プライバシーポリシーは `docs/legal/` に下書きがある
