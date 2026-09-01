# ノビノート（オンライン家庭教師 管理サイト / PWA）

チューターと学生・保護者が同じ記録を見られる Web アプリです。ホーム画面に追加して
アプリのように使い、新しい宿題や連絡はプッシュ通知で届きます。

- **入口**：「学生・保護者です」／「チューターです」の2択 → パスコード入力
  （一度入力すればその端末では以後スキップ）
- **授業記録**：日付／科目／学習範囲／内容／所感（チューターが入力、全員が閲覧）
- **宿題**：内容・期限・提出チェック・質問
- **成績**：テストの点数を登録し、科目別に得点率の推移をグラフ表示
- **連絡**：チューターと学生・保護者の共有メッセージ欄
- **設定**（チューターのみ）：生徒の追加、生徒別パスコードの設定、自分のパスコード変更

## パスコードについて

- チューターの初期パスコードは **0000**（`config/tutor` に自動作成されます）。
  設定タブでいつでも変更でき、変更した端末以外では次回に再入力が必要になります。
- 学生・保護者は、チューターが生徒ごとに設定したパスコードを入力します。
  パスコードで生徒が特定されるので、生徒を選ぶ操作は不要です。

> **セキュリティの前提**：パスコードの照合はブラウザ側で行っており、Firestore の
> ルールでは検証できません（＝URL と DB を直接叩ける相手には効きません）。
> URL とパスコードは関係者だけに共有してください。
> より厳密にしたい場合は、パスコードを Cloud Functions で検証してカスタムトークンを
> 発行する方式に差し替えられます。

## セットアップ

### 1. Firebase プロジェクト
[Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成し、
- **Authentication → Sign-in method → 匿名** を有効化
- **Firestore Database** を作成
- **Cloud Messaging → ウェブプッシュ証明書** で鍵ペアを生成（VAPID キー）

### 2. 設定値を貼る
「プロジェクトの設定 → マイアプリ → ウェブアプリ」の値を **2か所** に貼ります。
- `firebase-config.js`（アプリ本体。VAPID キーもここ）
- `firebase-config-sw.js`（Service Worker 用。同じ値）

### 3. 公開
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore
```
※ 通知には **HTTPS** が必須なので、Firebase Hosting などに公開して使ってください。

### 4. 通知（プッシュ）を有効にする
サーバー側から送るため Cloud Functions を使います（**Blaze プラン**が必要）。
```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```
`functions/index.js` が、宿題・授業記録・連絡の追加を検知して、
その生徒に紐づく端末（書いた本人以外）へ通知を送ります。

### 5. ホーム画面に追加
- **iPhone/iPad**：Safari で開く → 共有 →「ホーム画面に追加」→
  ホーム画面のアイコンから起動 → 「通知をオンにする」
  （iOS はホーム画面に追加したアプリからでないと通知を許可できません）
- **Android/PC**：Chrome のインストールボタン →「通知をオンにする」

### 6. 初回の準備
チューターとして 0000 で入り、「設定」タブで生徒を追加し、生徒のパスコードを決めて
学生・保護者に伝えてください。あわせてチューターのパスコードも変更しておくと安全です。

## データ構造

```
config/tutor                        { passcode }
students/{sid}                      { name, passcode }
students/{sid}/lessons/{id}         { date, subject, range, content, notes }
students/{sid}/homework/{id}        { title, detail, dueDate, done, question }
students/{sid}/tests/{id}           { date, subject, name, score, max }
students/{sid}/messages/{id}        { text, authorRole, createdAt }
students/{sid}/tokens/{fcmToken}    { role, updatedAt }   ← 通知の送り先
```

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` / `style.css` / `app.js` | アプリ本体 |
| `firebase-config.js` / `firebase-config-sw.js` | Firebase の設定値（要編集） |
| `manifest.json` / `icon-*.png` | PWA（ホーム画面追加） |
| `sw.js` | オフラインキャッシュ |
| `firebase-messaging-sw.js` | プッシュ通知の受信 |
| `functions/index.js` | 通知の送信（Cloud Functions） |
| `firestore.rules` / `firebase.json` | ルールとデプロイ設定 |
