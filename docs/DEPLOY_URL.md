# 本番URL（Render・2026-07-26デプロイ）

> ⚠️ **2026-07-29: URLの変更を予定しています。**
> サービス名を「ALLVERSE」に統一するため、Renderのサービス名を `verse-city-web` から
> `allverse`（または空きがなければ `allverse-world` 等）へ変更します。
> **変更するとこのページのURLはすべて無効になります。**
> 手順は SETUP_AUTH.md の「A. Renderのサービス名を変更」。
> 変更後は、このファイルの記載とUnity側チャットへの共有を更新すること。

## 公開URL（変更前）

- **会場**: https://verse-city-web.onrender.com
- **presence.json（VRC連携用・ALLVERSE Workerの取得先）**: https://verse-city-web.onrender.com/api/presence.json
- **ステータス**: https://verse-city-web.onrender.com/api/status

## 検証結果（2026-07-26）

- ページ配信: 200 OK
- presence.json: 200 OK（v=1形式）
- WebSocket（wss://verse-city-web.onrender.com/ws）: join→welcome 成功
- 注意: デプロイ直後の1〜2分はWSが404になることがある（プロキシ安定化前）。リトライで解消

## 運用メモ

- Render無料プラン: 15分無アクセスでスリープ→初回アクセスで数十秒の起き上がり
  - イベント前に一度URLを開いておく運用でカバー
  - Worker側は4秒キャッシュ＋鮮度判定で吸収する設計（合意済み）
- 更新方法: `git push` するだけで自動再デプロイ（数分）
- Unity側へ: Workerの環境変数にこの presence.json URL を設定してください
