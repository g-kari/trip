# 環境構築ガイド

## 前提条件

- Node.js 18+
- npm
- Cloudflareアカウント

## 初期セットアップ

```bash
# 依存関係のインストール
npm install

# Cloudflareにログイン
npx wrangler login

# D1データベースの作成
npx wrangler d1 create trip-itinerary

# wrangler.tomlのdatabase_idを更新
# 出力されたIDをwrangler.tomlのdatabase_idに設定

# マイグレーション実行
npx wrangler d1 migrations apply trip-itinerary
```

## 認証設定

### Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 新規プロジェクトを作成（または既存を選択）
3. 「APIとサービス」→「有効なAPIとサービス」から「Google+ API」または「People API」を有効化
4. 「認証情報」→「認証情報を作成」→「OAuth 2.0 クライアントID」
5. アプリケーションの種類: 「ウェブアプリケーション」
6. 承認済みのリダイレクトURI:
   - 本番: `https://your-domain.com/api/auth/google/callback`
   - ローカル: `http://localhost:8787/api/auth/google/callback`
7. クライアントIDとクライアントシークレットをコピー
8. シークレットを設定:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

### LINE Login

1. [LINE Developers Console](https://developers.line.biz/console/) にアクセス
2. プロバイダーを作成（未作成の場合）
3. 「LINE Login」チャネルを新規作成
4. チャネル設定:
   - 「アプリタイプ」で「ウェブアプリ」を有効化
   - コールバックURLを追加:
     - 本番: `https://your-domain.com/api/auth/line/callback`
     - ローカル: `http://localhost:8787/api/auth/line/callback`
5. 「チャネル基本設定」からチャネルIDとチャネルシークレットをコピー
6. シークレットを設定:
   ```bash
   npx wrangler secret put LINE_CHANNEL_ID
   npx wrangler secret put LINE_CHANNEL_SECRET
   ```

### セッションシークレット

```bash
npx wrangler secret put SESSION_SECRET
# 32文字以上のランダムな文字列を入力
```

## 環境変数一覧

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth クライアントID | ○ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット | ○ |
| `LINE_CHANNEL_ID` | LINE Login チャネルID | △ |
| `LINE_CHANNEL_SECRET` | LINE Login チャネルシークレット | △ |
| `SESSION_SECRET` | セッション暗号化用シークレット | ○ |

※ LINE認証を使用しない場合は LINE_* は不要

## ローカル開発

```bash
# フルスタック開発サーバー（Workers + API + 静的アセット）
npm run dev

# フロントエンドのみ（Vite HMR、API無し）
npm run dev:web
```

## デプロイ

```bash
# ビルド＆デプロイ
npm run build
npx wrangler deploy
```

## トラブルシューティング

### 「Invalid redirect URI」エラー
- Google/LINE Consoleで設定したリダイレクトURIと実際のURLが一致しているか確認
- プロトコル（http/https）とポート番号も一致させる

### 「Session secret not configured」エラー
- `npx wrangler secret put SESSION_SECRET` で設定

### データベースエラー
- `wrangler.toml` の `database_id` が正しいか確認
- マイグレーションが実行されているか確認: `npx wrangler d1 migrations list trip-itinerary`

## Stripe決済設定

旅程枠の購入機能を有効にするための設定です。

### 1. Stripeアカウント作成

1. [Stripe](https://stripe.com/jp) にアクセス
2. 「今すぐ始める」からアカウント作成
3. 本番利用には本人確認・ビジネス情報の登録が必要

### 2. APIキーの取得

1. [Stripeダッシュボード](https://dashboard.stripe.com/) にログイン
2. 「開発者」→「APIキー」
3. 以下のキーをコピー:
   - **シークレットキー** (`sk_live_...` または `sk_test_...`)

**テスト環境と本番環境:**
- テスト: `sk_test_...` キーを使用（実際の課金なし）
- 本番: `sk_live_...` キーを使用（実際の課金あり）

### 3. Webhookの設定

1. 「開発者」→「Webhook」→「エンドポイントを追加」
2. 設定:
   - **エンドポイントURL**: `https://shio.0g0.xyz/api/payment/webhook`
   - **リッスンするイベント**:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
3. 「エンドポイントを追加」をクリック
4. 作成後、「署名シークレット」（`whsec_...`）をコピー

### 4. シークレットの設定

```bash
# Stripe シークレットキー
npx wrangler secret put STRIPE_SECRET_KEY
# → sk_test_... または sk_live_... を入力

# Webhook 署名シークレット
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# → whsec_... を入力
```

### 5. 動作確認（テストモード）

1. テストキー（`sk_test_...`）を設定
2. プロフィールページで「旅程枠を購入」をクリック
3. Stripeのテストカード番号で決済:
   - カード番号: `4242 4242 4242 4242`
   - 有効期限: 未来の日付
   - CVC: 任意の3桁
4. 購入完了後、プロフィールに枠が追加されることを確認

### 6. 本番モードへの切り替え

1. Stripeダッシュボードで本番モードに切り替え
2. 本番用APIキー（`sk_live_...`）を取得
3. 本番用Webhookを作成し、署名シークレットを取得
4. シークレットを更新:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# → sk_live_... を入力

npx wrangler secret put STRIPE_WEBHOOK_SECRET
# → 本番用の whsec_... を入力
```

### 料金設定

現在の設定（`src/worker.ts`）:
- **¥100 / 枠**
- 1〜10枠まで一度に購入可能
- 一度でも購入 → 永久プレミアム（広告非表示）

料金を変更する場合は `TRIP_SLOT_PRICE` を編集:

```typescript
const TRIP_SLOT_PRICE = 100; // ¥100 per trip slot
```

### Stripe環境変数一覧

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `STRIPE_SECRET_KEY` | Stripe APIシークレットキー | ○ |
| `STRIPE_WEBHOOK_SECRET` | Webhook署名シークレット | ○ |

### トラブルシューティング

#### 「決済セッションの作成に失敗しました」
- `STRIPE_SECRET_KEY` が正しく設定されているか確認
- Stripeダッシュボードでテスト/本番モードが一致しているか確認

#### Webhookが動作しない
- エンドポイントURLが正しいか確認（HTTPS必須）
- `STRIPE_WEBHOOK_SECRET` が正しく設定されているか確認
- Stripeダッシュボードの「Webhook」→「ログ」でエラーを確認

#### 購入後に枠が増えない
- Webhookが正しく設定されているか確認
- Stripeダッシュボードで該当イベントが送信されているか確認
- Cloudflareのログでエラーを確認: `npx wrangler tail`
