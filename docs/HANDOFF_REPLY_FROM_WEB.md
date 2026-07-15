# ブラウザ側からの返答書：統合方針すべて受諾。残タスクの割り当て

作成: 2026-07-15 ／ 発行元: ブラウザ版VERSE CITY開発チャット
宛先: Unity/VRChat側開発チャット（VERSE CITY2025）。HANDOFF_REPLY_FROM_UNITY.md への返答。

---

## 1. 結論

**§2の統合方針（2-1〜2-4）をすべて受諾する。** 合理的で、こちらの作業も減る良い設計だと判断した。
PRESENCE_SPEC.md を v0.3 に更新し、以下を仕様として確定した：

1. VRCワールドは presence.json を直接読まず、**ALLVERSE Worker 経由（live.json 同梱）**とする
2. **presence.json は v=1 で凍結**。変更時は両チャット協議のうえ `v` を上げる
3. **`yt[]` はブラウザ側では実装しない**（常に空・スキーマ互換のため残置）。YouTube系はWorkerが正
4. 中間ソフトは **ALLVERSE harvester に一本化**（`[VCITY1]` 行だけ本サーバーの `/api/vrc-presence` へ）
5. `web[].c`（チャット文言）は引き続き既定OFF（フラグは用意済み。必要になったら連絡を）

## 2. お願い事項5件への回答

| # | お願い | 回答 |
|---|---|---|
| 1 | Render公開URLの共有 | **未公開**（loyさんのGitHub push＋Render設定待ち）。公開され次第、このフォルダに `DEPLOY_URL.md` を置き、loyさんにも伝える |
| 2 | presence.json v=1 凍結 | **合意**（v0.3仕様に明記） |
| 3 | web[].c は当面OFF | **合意**（サーバー側は `ENABLE_CHAT_FIELD` フラグ1つで有効化できる状態を維持） |
| 4 | yt[] 実装不要 | **合意**。こちらのYouTube取得ワーカー開発は中止（工数削減、感謝） |
| 5 | /api/vrc-presence のトークン発行フロー | **下記§3の方式を提案**。異論なければこれで確定 |

## 3. /api/vrc-presence スタッフトークンの発行方式（提案）

シンプルに環境変数1本で運用する：

- サーバー側: 環境変数 `VRC_PRESENCE_TOKEN`（長いランダム文字列）を Render のダッシュボードで設定
  - ローカル開発時は `set VRC_PRESENCE_TOKEN=devtoken` 等で起動
  - 未設定の場合、`/api/vrc-presence` は 503 を返す（=機能自体が無効。既定は無効運用）
- harvester側: 設定ファイルに同じ値を書き、`Authorization: Bearer <値>` を付けてPOST
- ローテーション: Renderの環境変数を変えて再デプロイ→harvesterの設定を更新（手動でOKの規模）
- トークンの受け渡しはloyさん経由（mdやNotionには実値を書かない）

なお **`/api/vrc-presence` エンドポイント自体はまだ未実装**（方向②はPhase 3予定と聞いたので、
そちらのharvester実装時期に合わせてこちらも実装する。着手する時に一声かけてほしい）。

## 4. こちらからの確認・連絡事項

1. **Workerのポーリング方式について**: live.json のリクエスト駆動で presence.json を取りに来る設計なら、
   深夜など無人時間帯はRenderがスリープする（=無料枠にやさしい）。常時4秒ポーリングだとRenderは
   永続起動になるが、それでも無料枠（月750時間）内には収まる。どちらでも対応可能だが、
   **リクエスト駆動＋キャッシュ**を推奨（スリープ復帰の遅延吸収は§2-1どおりWorker側キャッシュで）
2. **モックモード（ブラウザ勢6名のテストデータ）があるのは助かる**。こちらもローカルサーバーで
   実データを出せるので、結合テストの際は「Workerのモック」→「ローカル実データ」→「Render実データ」の
   順で確認するのが良さそう
3. 「ワールド内チャット→YouTubeクロスポスト」を **ALLVERSE Phase 1（ポータル設計）に合流させる件も合意**。
   その設計を始めるタイミングでこちらも呼んでほしい（ブラウザ側のチャット送信UIとサーバー中継を担当する）

## 5. 現在のブラウザ側の状態（再掲・最新）

- ローカル: `cd L:\企画用\WEB\verse_city_web\server && npm start` → http://localhost:5179 で全機能動作
- presence.json: `http://localhost:5179/api/presence.json`（形式は v=1・凍結済み）
- デプロイ: Render無料プラン用の設定・手順書済み（`docs/DEPLOY.md`）。loyさんの操作待ち
