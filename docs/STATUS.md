# STATUS — VERSE CITY Web / (ALLVERSE parallel 候補)

最終更新: 2026-07-26 ／ 現在地: **フェイズ1「両世界の窓」の中盤**

## 一言でいうと

ブラウザ会場のマルチプレイ実装は完成し、友人らとの実地テストも成功済み。
残る大物は「Renderデプロイ（ユーザー操作5分）」と「Unity側presence連携の結合」。

## できていること（検証済み）

### ブラウザ会場（フェイズ1の本体）
- 3D仮ワールド「VERSE CITY」（ネオンシティ×ライブステージ。Three.js製・ビルド不要の静的サイト）
- 入場画面でのアバターカスタマイズ（髪型4種×肌8×髪8×服8）＋入場後の再カスタム
- 三人称移動（WASD/ドラッグ視点）・スマホ対応（バーチャルパッド・ピンチズーム・チャット折りたたみ）
- テキストチャット（ネームプレート・吹き出け付き）
- YouTube埋め込みスクリーン（CSS3D方式。入場ボタンのクリックを起点に音声つき自動再生）
- **リアルタイムマルチプレイ**: WebSocket同期サーバー（ルーム制30人・#1から自動割当・防御込み・自動テスト7項目PASS）
- サーバー未接続時はNPCデモモードへ自動フォールバック（`?npc=1`で任意追加も可）
- 実地テスト: 2026-07-17にトンネル一時公開でユーザー＋友人ら（Lily・りりぃ・なつすけ等）が同時入場し、相互表示・チャット・移動同期を確認

### VRChat側との連携（仕様合意済み・実装は分担中）
- `GET /api/presence.json`（v=1で**凍結**）稼働中。ブラウザ勢の名前・座標・向き・アバター見た目を公開
- Unity側チャットと文書ベースで合意済み（docs/HANDOFF_*.md 3枚）:
  - VRCワールドは presence.json を**直接読まず ALLVERSE Worker 経由**（live.json同梱・4秒キャッシュ）
  - YouTube系データはWorkerが正。**こちらの yt[] は実装しない（常に空）**
  - 中間ソフトはALLVERSE harvesterに一本化（`[VCITY1]`行→こちら、`[ALLVERSE]`行→Worker）
- Unity側は「Worker側presence統合は実装済み・モックモードあり」と報告（2026-07-15返答書）

### ドキュメント体系
- 原本はこのdocs/のmd（Notionは写し）: PROTOCOL.md / PRESENCE_SPEC.md(v0.3) / HANDOFF 3枚 / DEPLOY.md / STATUS・SPEC・WHY（本棚卸し3枚）

## 次にやること（優先順）

1. **Renderデプロイ**（無料プラン・手順は DEPLOY.md・所要5分）
   - **ユーザーの操作待ち**: ①GitHubへpush ②RenderでBlueprint適用
   - 完了後: 公開URLを docs/DEPLOY_URL.md に記録し、Unity側（Worker環境変数）へ共有
2. **結合テスト**: Workerモック → ローカル実データ → Render実データ の順（Unity側と合意済み）
3. フェイズ1期間の機能育成（**着手には都度ユーザーOKが必要**）: VRM対応（レギュラー）、ボイチャ、ルーム一覧・友達合流、テクスチャカスタム（承認制）
4. ALLVERSE Phase 1（ポータル設計）合流時: ワールド内チャット→YouTubeクロスポスト設計、VERSE COIN資金決済法整理

## 保留・未解決

| 項目 | 状態 |
|---|---|
| `/api/vrc-presence`（VRC→ブラウザ方向の受け口） | 未実装。Unity側harvester実装（Phase 3）に合わせて着手。トークンは環境変数方式を提案済み・返答待ち |
| `web[].c`（チャット文言のVRC側表示） | サーバーにフラグ実装済み・既定OFF。Unity側から要望が来たらON |
| ブラウザでのVR空間の負荷問題 | フェイズ2の鍵と本人が認識（2026-07-26時点・別チャット談）。未着手 |
| ネーミング（ALLVERSE parallel / VERSE CITY parallel） | 候補のまま未確定。ポータルのドメイン設計時に確定予定 |
| 一時公開トンネル | テスト時のみ都度発行（URLは毎回変わる）。恒久化はRenderデプロイで解消 |

## 起動方法（ローカル）

```
cd L:\企画用\WEB\verse_city_web\server && npm start   # サーバー(5179)＝静的配信+WS+presence
```
→ http://localhost:5179 を開く。gitはローカルリポジトリ運用中（リモート未設定）。
