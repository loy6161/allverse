# セットアップ手順（サービス名の変更 ／ Googleログイン ／ Turso）

loyさんの作業ぶんだけをまとめたもの。**すべて無料**で、クレジットカードは要りません。
所要時間は全部で30分ほど。

**必ずこの順番でやってください。** Aで本番URLを確定しないと、Bの登録をやり直すことになります。
**Aは2026-07-29に完了済み。本番URLは `https://allverse.onrender.com` です。**

| | 内容 | 目安 |
|---|---|---|
| **A** | 名前をALLVERSEに揃える（GitHub改名＋Render作り直し） ✅完了 | 10分 |
| **B** | Googleログインの設定（Aで決めたURLを登録する） | 10分 |
| **C** | Tursoの設定（イベントを保存する） | 5分 |
| **D** | 動作確認 | 5分 |

---

## 設定しない間はどうなるか

| | 未設定のとき | 設定後 |
|---|---|---|
| Googleログイン | ログインボタンが出ない。**全員が今まで通り何でもできる** | ログインした人だけがコメント・エモート・見た目変更。動画操作は管理者だけ |
| イベントの保存 | メモリのみ。**サーバーが寝ると作ったイベントが消える** | 消えない。前日に仕込んでおける |

急がなくても壊れません。ライブで本格運用する前までに設定すればOKです。

---

## A. 名前をALLVERSEに揃える（10分）

### 前提: Renderは改名してもURLが変わらない

**Renderは `.onrender.com` のサブドメインをサービス作成時に固定します。**
ダッシュボードでサービス名を変えてもURLは変わりません（2026-07-29に実測で確認）。
URLも揃えるには**サービスを作り直す**しかありません。

### A-1. GitHubのリポジトリ名を変更 ✅ 完了（2026-07-29）

`loy6161/verse-city-web` → **`loy6161/allverse`**

GitHubは旧URLから自動でリダイレクトするので、これ自体では何も壊れません。
ローカルの参照先（git remote）はClaude側で切り替え済みです。

### A-2. Renderで新しいWeb Serviceを作る ✅ 完了（2026-07-29）

**Blueprintではなく、普通の Web Service として作ります。**
既存サービスがBlueprint管理下にあり、Blueprintから作ると切り離しと削除が先に必要になるためです。
普通のWeb Serviceなら、既存に触れずに並行して立ち上げられます。

1. ダッシュボードで「New +」→ **Web Service**
2. リポジトリ **`loy6161/allverse`** を選択
3. 以下を入力

   | 項目 | 値 |
   |---|---|
   | **Name** | `allverse` |
   | **Region** | **Singapore** |
   | **Branch** | `master` |
   | **Root Directory** | `server` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `node server.js` |
   | **Instance Type** | Free |

4. 「Create Web Service」

> **Regionを Singapore にする理由**: 旧サービスは Oregon（米西海岸）にありました。
> このアプリは位置情報を毎秒10回やり取りするので、日本から近い方が体感がはっきり良くなります。
> 作り直す今がリージョンを選び直せる唯一のタイミングです。

数分で `https://allverse.onrender.com` が立ち上がります。

### A-3. 動作確認 ✅ 完了（2026-07-29）

```
https://allverse.onrender.com/api/status
```

`{"ok":true,...}` が返れば成功です。

### A-4. 古いサービスとBlueprintを削除 ✅ 完了（2026-07-29）

新しい方が動くのを確認してから、古いサービスと Blueprint を削除しました。

**消すのは2つ**です。サービスだけ消しても Blueprint が残っていると、
次のpushで `render.yaml` の記述どおりに旧サービスが再生成されてしまいます。

1. サービス（旧 `verse-city-web`）を削除
2. **Blueprint 本体も削除**（ダッシュボード左メニューの Blueprints → Settings → Delete Blueprint）

> 消えて困るデータはRenderにありません（コードはGitHub、イベントはTurso）。
> 今回はサービスを先に消したが、Blueprintの同期が走る前に消したため再生成は起きなかった。

### A-5. 結果

- 本番URL: **https://allverse.onrender.com**
- 旧URL `verse-city-web.onrender.com` は削除済み（404）
- `render.yaml`・`docs/DEPLOY_URL.md` は更新済み
- **Unity側チャットへの連絡文は `docs/DEPLOY_URL.md` にあります**（コピーして渡すだけ）

---

## B. Googleログイン（10分）

### B-1. Google Cloud でプロジェクトを作る

1. https://console.cloud.google.com/ を開いてGoogleアカウントでログイン
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」
3. プロジェクト名は `allverse` など分かるもの →「作成」

### B-2. OAuth同意画面を設定する

1. 左メニュー →「APIとサービス」→「OAuth同意画面」
2. User Type は **「外部」** を選んで「作成」
3. 入力するのは3つだけ
   - アプリ名: **ALLVERSE** ← ログイン時に「ALLVERSEにログイン」と表示されます
   - ユーザーサポートメール: 自分のメール
   - デベロッパーの連絡先情報: 自分のメール
4. 「保存して次へ」を、スコープ・テストユーザーの画面もそのまま進めて完了

> **アプリ名は後からいつでも変えられます。** 迷っても止まらなくて大丈夫です。
>
> 「テストユーザー」のままだと、自分で登録した人しかログインできません。
> みんなに使ってもらう段階になったら、同意画面の「公開ステータス」を**本番環境に**してください。
> （メールアドレスと名前しか受け取らないので、Googleの審査は不要です）

### B-3. クライアントIDを作る

1. 「APIとサービス」→「認証情報」→「+ 認証情報を作成」→「OAuth クライアント ID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 名前: `allverse-web`
4. **承認済みの JavaScript 生成元** に次の2つを追加（ここが一番大事）
   ```
   https://allverse.onrender.com
   http://localhost:5179
   ```
5. 「作成」→ 表示される **クライアントID**（`......apps.googleusercontent.com`）をコピー

> クライアントシークレットは使いません。コピーしなくて大丈夫です。
> 末尾のスラッシュは付けないでください（`https://allverse.onrender.com/` は不可）。

### B-4. Render に登録する

1. Renderのサービス → 左の **Environment**
2. 「Add Environment Variable」で次を追加

   | Key | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | B-3でコピーしたクライアントID |
   | `ADMIN_EMAILS` | 管理者にしたい人のGmail（カンマ区切り） |
   | `VIP_EMAILS` | 全ルームに現れる人のGmail（カンマ区切り） |

   例:
   ```
   ADMIN_EMAILS = loy61loy61@gmail.com
   VIP_EMAILS   = staff1@gmail.com,staff2@gmail.com
   ```
3. 「Save, rebuild, and deploy」で反映（数分）

> **メールアドレスはRenderの設定画面にだけ書きます。** GitHubやNotionには書かないでください。

---

## C. Turso（イベントの保存・5分）

### C-1. アカウントとデータベースを作る

1. https://turso.tech/ →「Start for free」→ GitHubアカウントでサインアップ
2. ダッシュボードで「Create Database」
3. 名前: `allverse` ／ リージョンは `Tokyo (nrt)` など近いところ
4. 作成後の画面で次の2つを取得
   - **Database URL**（`libsql://allverse-xxxx.turso.io` のような文字列）
   - **Auth Token**（「Create Token」を押すと発行される長い文字列）

### C-2. Render に登録する

Bと同じ「Environment」画面で追加します。

| Key | Value |
|---|---|
| `TURSO_DATABASE_URL` | C-1のDatabase URL |
| `TURSO_AUTH_TOKEN` | C-1のAuth Token |

「Save, rebuild, and deploy」で反映。

---

## D. 動作確認

ブラウザで次を開くと、状態がそのまま出ます。

```
https://allverse.onrender.com/api/status
```

- `"login": true` … Googleログインが有効
- `"persistent": true` … イベントが保存されるようになった

そのあとトップページを開いて、

1. 入場画面に「Google でログイン」ボタンが出ている
2. 管理者のメールでログインすると、右下に **📺 動画変更** と **🚪 イベント/ルーム** のボタンが出る
3. ログインせずに入ると、コメント欄に「コメントするにはログインが必要です」と出る

ここまで確認できたら完了です。

---

## つまずいたときは

**ログインボタンが出ない**
`GOOGLE_CLIENT_ID` が入っているか、デプロイが終わっているかを確認。`/api/status` の `login` が `false` なら未反映です。

**ログインしようとするとエラーになる（redirect_uri_mismatch / origin エラー）**
B-3の「承認済みの JavaScript 生成元」が本番URLと一致していないケースがほとんどです。
`https://` から始まっているか、末尾にスラッシュが付いていないかを確認してください。

**自分が管理者にならない**
`ADMIN_EMAILS` のメールと、実際にログインしたGoogleアカウントのメールが一致しているか確認してください（大文字小文字は区別しません）。

**イベントが消える**
`/api/status` の `persistent` が `false` なら、Tursoの2つの環境変数を見直してください。

**古いURL（verse-city-web.onrender.com）を開いてしまう**
ブックマークやUnity側の設定が旧URLのままです。`allverse.onrender.com` に差し替えてください。

---

## 補足: 有料プランの話（今は不要）

Renderの無料プランは15分アクセスがないとスリープし、次のアクセスで起き上がるのに数十秒かかります。
ライブ開始前に管理者が一度URLを開いておけば実用上は問題ありません。
どうしても消したい場合は月$7ほどの有料プランになりますが、**移行前に必ず相談してください**。
