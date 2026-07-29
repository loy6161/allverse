# セットアップ手順（Googleログイン ／ Turso）

loyさんの作業ぶんだけをまとめたもの。**どちらも無料**で、クレジットカードは要りません。
設定しなくてもサイトは動きます（下の「設定しない間はどうなるか」参照）。

所要時間はあわせて15分ほど。

---

## 設定しない間はどうなるか

| | 未設定のとき | 設定後 |
|---|---|---|
| Googleログイン | ログインボタンが出ない。**全員が今まで通り何でもできる** | ログインした人だけがコメント・エモート・見た目変更。動画操作は管理者だけ |
| イベントの保存 | メモリのみ。**サーバーが寝ると作ったイベントが消える** | 消えない。前日に仕込んでおける |

つまり急がなくても壊れません。ライブで本格運用する前までに設定すればOKです。

---

## A. Googleログイン（10分）

### A-1. Google Cloud でプロジェクトを作る

1. https://console.cloud.google.com/ を開いてGoogleアカウントでログイン
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」
3. プロジェクト名は `verse-city-web` など分かるもの →「作成」

### A-2. OAuth同意画面を設定する

1. 左メニュー →「APIとサービス」→「OAuth同意画面」
2. User Type は **「外部」** を選んで「作成」
3. 入力するのは3つだけ
   - アプリ名: `VERSE CITY WEB`
   - ユーザーサポートメール: 自分のメール
   - デベロッパーの連絡先情報: 自分のメール
4. 「保存して次へ」を、スコープ・テストユーザーの画面もそのまま進めて完了

> 「テストユーザー」のままだと、自分で登録した人しかログインできません。
> みんなに使ってもらう段階になったら、同意画面の「公開ステータス」を**本番環境に**してください。
> （メールアドレスと名前しか受け取らないので、Googleの審査は不要です）

### A-3. クライアントIDを作る

1. 「APIとサービス」→「認証情報」→「+ 認証情報を作成」→「OAuth クライアント ID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 名前: `verse-city-web`
4. **承認済みの JavaScript 生成元** に次の2つを追加（ここが一番大事）
   ```
   https://verse-city-web.onrender.com
   http://localhost:5179
   ```
5. 「作成」→ 表示される **クライアントID**（`......apps.googleusercontent.com`）をコピー

> クライアントシークレットは使いません。コピーしなくて大丈夫です。

### A-4. Render に登録する

1. https://dashboard.render.com/ → `verse-city-web` サービス → 左の「Environment」
2. 「Add Environment Variable」で次を追加

   | Key | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | A-3でコピーしたクライアントID |
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

## B. Turso（イベントの保存・5分）

### B-1. アカウントとデータベースを作る

1. https://turso.tech/ →「Start for free」→ GitHubアカウントでサインアップ
2. ダッシュボードで「Create Database」
3. 名前: `verse-city` ／ リージョンは `Tokyo (nrt)` など近いところ
4. 作成後の画面で次の2つを取得
   - **Database URL**（`libsql://verse-city-xxxx.turso.io` のような文字列）
   - **Auth Token**（「Create Token」を押すと発行される長い文字列）

### B-2. Render に登録する

Aと同じ「Environment」画面で追加します。

| Key | Value |
|---|---|
| `TURSO_DATABASE_URL` | B-1のDatabase URL |
| `TURSO_AUTH_TOKEN` | B-1のAuth Token |

「Save, rebuild, and deploy」で反映。

---

## 設定できたかの確認

ブラウザで次を開くと、状態がそのまま出ます。

```
https://verse-city-web.onrender.com/api/status
```

- `"login": true` … Googleログインが有効
- `"persistent": true` … イベントが保存されるようになった

入場画面に「Google でログイン」ボタンが出ていれば成功です。
管理者のメールでログインすると、動画の変更ボタンとイベント作成欄が現れます。

---

## つまずいたときは

**ログインボタンが出ない**
`GOOGLE_CLIENT_ID` が入っているか、デプロイが終わっているかを確認。`/api/status` の `login` が `false` なら未反映です。

**ログインしようとするとエラーになる**
A-3の「承認済みの JavaScript 生成元」にURLが入っていないケースがほとんどです。末尾のスラッシュは付けないでください。

**自分が管理者にならない**
`ADMIN_EMAILS` のメールと、実際にログインしたGoogleアカウントのメールが一致しているか確認してください（大文字小文字は区別しません）。

**イベントが消える**
`/api/status` の `persistent` が `false` なら、Tursoの2つの環境変数を見直してください。
`true` なのに消える場合はイベントが「常設(main)」ではなく人が残っていた可能性があります。

---

## 補足: 有料プランの話（今は不要）

Renderの無料プランは15分アクセスがないとスリープし、次のアクセスで起き上がるのに数十秒かかります。
ライブ開始前に管理者が一度URLを開いておけば実用上は問題ありません。
どうしても消したい場合は月$7ほどの有料プランになりますが、**移行前に必ず相談してください**。
