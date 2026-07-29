# デプロイ手順（Render 無料プラン）

サーバー1本（server/server.js）が「クライアント静的配信＋WebSocket同期＋presence.json」を
すべて担う構成なので、デプロイするサービスは1つだけ。

## 構成と費用

- **Render Free プラン: 0円**
- 制約: 15分アクセスがないとスリープし、次のアクセス時に起き上がりに数十秒かかる
  - イベント運用なら「開始前に一度URLを開いておく」で実用上問題なし
  - 常時起動が必要になったら有料プラン（月$7〜）だが、**移行前に必ず相談・許可を取ること**

## 手順（初回のみ・約5分）

1. GitHubに本リポジトリを push（プライベートでOK）
2. https://render.com にGitHubアカウントでサインアップ（無料）
3. ダッシュボード →「New +」→「Blueprint」→ このリポジトリを選択
   （render.yaml が自動で読まれ、設定入力は不要）
4. 「Apply」でデプロイ開始。数分で `https://allverse.onrender.com` のようなURLが発行される

## ⚠️ 落とし穴: クライアントだけの変更が本番に出ない（2026-07-30 判明）

**症状**: `src/` や `style.css` だけを直して push しても、本番がいつまでも古いまま。
Render のログを見ないと「デプロイが走っていない」ことに気づけない。

**原因**: 本番サービスは **Root Directory = `server`** で作られている。
Render は Root Directory が設定されていると、
**その配下に変更が無い push ではデプロイを省略する**（モノレポ向けの挙動）。
このプロジェクトはサーバー1本がクライアントも配信する構成なので、
画面の修正は全部 `server/` の外にあり、ほぼ毎回スキップされてしまう。

実際に確認した事実（2026-07-30）:
- 本番が返していたのは `server/` を最後に触ったコミット（`2bcefbe`）そのもの
- その後の9コミット（clubVERSE移植・スマホUI・一人称視点など）は未反映
- `src/world_club.js` が本番で 404 になっていた

**恒久対応（Renderのダッシュボードで設定変更が必要）**: 次のどちらか。
1. Root Directory を空にして、Build Command `npm install --prefix server` /
   Start Command `node server/server.js` に変更する（おすすめ）
2. Root Directory は残したまま、Build Filters の Included Paths に
   `src/**`, `assets/**`, `style.css`, `index.html` を追加する

**その場しのぎ**: `server/` 配下のファイルを何か変更して一緒に push する。
毎回必要になるので、恒久対応をするまでの応急処置として扱うこと。

**確認方法**: `https://<URL>/api/status` の `commit` が、いま出したいコミットと
一致しているかを見る（この値は Render の環境変数から取っている）。

## 通常の更新

`server/` を含む push なら自動再デプロイされる。含まない場合は上記の落とし穴を参照。

## 動作確認

- `https://<発行URL>/` → 入場画面が出る
- 2端末（PC+スマホ等）で入場 → お互いが見える
- `https://<発行URL>/api/presence.json` → 入場中ユーザーのJSON（VRC側ギミックの取得先はこのURL）
- `https://<発行URL>/api/status` → ルーム状況

## 技術メモ

- クライアントは同一オリジン配信時、自動で `wss://<同じホスト>/ws` に接続する（src/net.js）
  - ローカル開発（:5178の静的サーバー利用）時は従来どおり `ws://localhost:5179/ws`
- Render は `PORT` 環境変数を渡してくる → server.js は `process.env.PORT` 対応済み
- 無料プランはスリープからの復帰時にWebSocketが一度切れるが、クライアントは
  オフラインデモモードに落ちるだけなので画面が壊れることはない（リロードで再接続）

## 代替候補（参考）

| 候補 | 費用 | 特徴 |
|---|---|---|
| Render Free（採用） | 0円 | 設定最小・スリープあり |
| Cloudflare Workers + Durable Objects | 0円枠あり | スリープなし・ただしサーバー実装の書き直しが必要 |
| Railway | 有料 | 使わない（課金事前確認ルール） |
