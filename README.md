# trip-itinerary

旅程（1泊2日とか）をサクッとまとめて共有できるWebアプリ。
**Cloudflareだけで完結**させる前提のスターター。

- Frontend: React + Vite
- Backend(API): Cloudflare Workers + Hono
- DB: Cloudflare D1 (SQLite)
- Hosting: Workers (Assets + API)

## 目的 / MVP

- 旅程を Day ごとのタイムラインで管理
- 各スポットにメモ/予算/地図リンク
- 共有URL（まずは token 方式でログイン無し）
- PDF/印刷（後で）

## 構成

- `src/worker.ts` … Workersエントリ。`/api/*` をHonoで処理、その他は静的配信
- `src/` … Reactフロント（Vite）
- `migrations/` … D1 migration（SQL）
- `wrangler.toml` … Workers/D1設定

## セットアップ

### 1) 依存関係

```bash
npm i
```

### 2) Cloudflareログイン

```bash
npx wrangler login
```

### 3) D1作成

```bash
npx wrangler d1 create trip-itinerary
```

作成結果に `database_id` が出るので、`wrangler.toml` のここを置き換える：

```toml
[[d1_databases]]
binding = "DB"
database_name = "trip-itinerary"
database_id = "REPLACE_ME" # ← ここ
```

### 4) マイグレーション適用

```bash
npx wrangler d1 migrations apply trip-itinerary
```

## 開発

### Workersで起動（API + 静的配信）

```bash
npm run dev
```

動作確認：

- `GET /api/health`
- `GET /api/trips`（今は空が返る想定）

### フロントだけ起動（Vite）

```bash
npm run dev:web
```

## デプロイ

```bash
npm run deploy
```

## TODO（次にやる）

- [ ] `POST /api/trips`（作成）
- [ ] `PUT /api/trips/:id`（更新）
- [ ] token共有URL（編集権限）
- [ ] Day/Item CRUD
- [ ] UI: タイムライン表示

## 注意

- `wrangler.toml` の `database_id` 未設定のままだとD1が動かない。
- npm audit の脆弱性はテンプレ依存の範囲。後でまとめて対応でOK。
