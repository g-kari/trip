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
