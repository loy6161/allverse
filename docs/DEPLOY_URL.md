# 本番URL（Render）

> **2026-07-29: URLが変わりました。** サービス名をALLVERSEへ統一するため、サービスを作り直しています。
> 旧 `verse-city-web.onrender.com` は**削除済み（404）**。以後は下記の新URLを使ってください。

## 公開URL

- **会場**: https://allverse.onrender.com
- **presence.json（VRC連携用・ALLVERSE Workerの取得先）**: https://allverse.onrender.com/api/presence.json
- **ステータス**: https://allverse.onrender.com/api/status
- **入場画面の設定（ログインの有無・イベント一覧）**: https://allverse.onrender.com/api/config

## 会場の開け方（2026-07-30 以降・常設イベント廃止後）

本番は**イベントが1つも無い状態では誰も入れない**（入場画面に「いまは開いていません」と出る）。
会場を開くには管理者アカウントで次の操作をする。

1. https://allverse.onrender.com を開いてGoogleログイン（`ADMIN_EMAILS` に入っているアカウント）
2. 「次へ（場所を選ぶ）」→ 入場画面に **「👑 イベントを立てる（管理者）」** が出る
   - ここが出ない＝管理者と判定されていない。`ADMIN_EMAILS` を確認する
3. イベント名／合言葉（空ならパブリック）／定員／ログイン必須／VRChatに出す を決めて作成

イベントはTursoに保存されるので、サーバーが再起動しても残る。
閉じたいときは入場後の🚪パネルから「閉じる」（中の人も退場になる）。

`ADMIN_EMAILS` はカンマ区切りで複数登録できる（大文字小文字は無視）。
管理者が1つだけだと、そのアカウントに入れなくなったとき**会場を開けなくなる**ので、
予備のアカウントも入れておくこと。

## サービス設定（2026-07-29 時点）

| 項目 | 値 |
|---|---|
| Name | `allverse` |
| Region | **Singapore**（旧: Oregon。位置を毎秒10回やり取りするため日本から近い方へ変更） |
| Branch | `master` |
| Root Directory | `server` |
| Build / Start | `npm install` / `node server.js` |
| Instance Type | Free |
| GitHub | https://github.com/loy6161/allverse （旧: verse-city-web） |

⚠️ **Blueprint管理ではありません。** 手動作成した Web Service です。
`render.yaml` は記録用で、変更しても本番には反映されません（設定変更はダッシュボードで行う）。

## 検証結果（2026-07-29・移行後）

- トップページ: 200 OK（`<title>ALLVERSE</title>` を確認）
- `/api/status`: 200 OK（イベント/ルーム構造つき）
- `/api/presence.json`: 200 OK（`v=1` 形式）
- アバターGLBの配信: 200 OK（`/assets/avatars/hair_long.glb` 15KB）
- 応答時間: 0.12秒前後（起床済みの状態）
- 旧URL `verse-city-web.onrender.com`: 404（削除済み・復活していないことを確認）

## 移行にともなう作業

- [x] GitHubリポジトリ改名（verse-city-web → allverse）
- [x] 新サービス作成（allverse / Singapore）
- [x] 旧サービス削除
- [x] Blueprint削除（放置すると次のpushで旧サービスが再生成されるため）
- [ ] **Unity側チャットへ新URLを共有**（下記の連絡文をそのまま渡せます）
- [ ] Google Cloud の「承認済みJavaScript生成元」に `https://allverse.onrender.com` を登録（SETUP_AUTH.md B）

## Unity側チャットへの連絡文（コピーして渡してください）

```
【重要・URL変更のお知らせ】ブラウザ版のURLが変わりました。

旧: https://verse-city-web.onrender.com   ← 削除済み（404）
新: https://allverse.onrender.com

ALLVERSE Worker が読む presence.json の取得先も変わります。
  新: https://allverse.onrender.com/api/presence.json

変更理由: サービス名を「ALLVERSE」に統一したため。
Renderは改名してもURLが変わらない仕様のため、サービスごと作り直しました。
あわせてリージョンを Oregon → Singapore に変更しています（日本からの応答が速くなります）。

presence.json の中身の仕様は v=1 のまま一切変えていません（凍結の約束どおり）。
URLの差し替えだけお願いします。

補足: ブラウザ側にイベント／ルームの二層構造を入れましたが、
presence.json には常設イベント（VERSE CITY）の参加者だけを出しています。
rm（ルーム番号）がイベントをまたぐと衝突するためで、v=1の意味を壊さないための措置です。
特別イベントの参加者もVRCに出したくなった場合は、v=2として相談させてください。
```

## 運用メモ

- Render無料プラン: 15分無アクセスでスリープ→初回アクセスで数十秒の起き上がり
  - イベント前に一度URLを開いておく運用でカバー
  - Worker側は4秒キャッシュ＋鮮度判定で吸収する設計（合意済み）
- 更新方法: `git push` するだけで自動再デプロイ（数分）
- イベント定義の永続化は Turso（未設定のうちはメモリのみ・SETUP_AUTH.md C）
