# CLAUDE.md

This file provides guidance for AI assistants working on the **trip-itinerary** codebase.

## Project Overview

テーマを選んで旅程を入力するだけで、そのまま人に見せられる綺麗なページが完成する旅行共有Webサービス。Cloudflareプラットフォーム上で完結（Workers + D1 + R2 + Assets）。

**コンセプト:** 「作るだけで綺麗」な旅程ページを招待リンクで限定共有。Web完結でアプリDL不要。

### 実装済み機能

#### コア機能
- **ランディングページ** — サービス紹介
- **Google / LINE ログイン** — ソーシャル認証
- **旅行一覧・作成** — 1旅行 = 1つの縦長ページ、検索・フィルター・ソート対応
- **テーマ選択（2種）** — 「しずか」（ミニマル） / 「写真映え」（ビジュアル重視）
- **ダークモード** — システム設定連動 / 手動切り替え
- **テキスト→旅程AI生成** — テキスト・画像貼り付けで自動パース（Workers AI）
- **カバー画像アップロード** — 写真映えテーマ用（R2保存）
- **招待リンク** — トークンベース、無効化・再発行可能
- **OGP動的プレビュー** — LINE/X共有時にテーマ連動の綺麗なカード生成

#### 旅程編集
- **ドラッグ&ドロップ並び替え** — アイテム・日程の順序変更
- **日程メモ** — 日ごとのメモ欄
- **思い出写真** — アイテムごとの写真アップロード
- **地図埋め込み** — Google Maps連携、複数地点表示
- **カレンダーエクスポート** — .ics形式でダウンロード
- **JSON/CSVエクスポート** — データバックアップ

#### 共同編集・共有
- **共同編集者招待** — オーナー/編集者/閲覧者の権限管理
- **共有ページ** — ログイン不要で閲覧可能
- **LINE/X共有ボタン** — SNS共有

#### 予算・経費
- **予算設定** — 旅行全体の予算上限
- **経費記録** — アイテムごとの費用入力
- **経費分割** — メンバー間の割り勘計算
- **精算サマリー** — 誰が誰にいくら払うか表示

#### 写真・アルバム
- **写真アルバムページ** — 旅程の写真を一覧表示
- **ライトボックス** — 写真の拡大表示、ナビゲーション

#### 通知・リマインダー
- **リマインダー設定** — 出発前通知（Push Notification）

#### その他
- **プロフィールページ** — アカウント情報、統計表示
- **統計ページ** — 旅行数、費用集計、訪問地ランキング
- **アーカイブ機能** — 過去の旅行を非表示に
- **複製機能** — 既存の旅程をコピー
- **テンプレート** — 公開テンプレートから新規作成
- **印刷対応** — 印刷用スタイル
- **PWA対応** — オフライン表示、ホーム画面追加
- **フィードバック** — ご意見・ご要望送信
- **持ち物リスト** — カテゴリ別チェックリスト、進捗表示

### 将来の追加機能

- 有料化（追加旅行 ¥100/ページ、MVP期間は無料）
- デザイン変更・テーマ追加
- 旅程AI解析（周辺情報・店舗情報チップス表示）

### 競合との差別化

- **「作るだけで綺麗」** — テーマ選択 + 旅程入力だけで完成品。ツール感ではなく完成品感
- **Web完結 × 招待リンク** — tabiori等はアプリDL必須。本サービスはURLだけで閲覧可能
- **限定公開が前提** — Holiday等の「みんなに公開」ではなく、身内だけに共有
- **テキスト→AI自動生成** — 旅程入力の手間を最小化

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Language    | TypeScript (strict mode, ES2022)    |
| Frontend    | React 19 + Vite 7                   |
| Backend/API | Cloudflare Workers + Hono 4         |
| Database    | Cloudflare D1 (SQLite)              |
| Storage     | Cloudflare R2 (画像アップロード)      |
| AI          | Cloudflare Workers AI (旅程テキストパース) |
| Auth        | 自前OAuth (Google / LINE)             |
| OGP生成     | Satori等 (Workers上で動的生成)        |
| Hosting     | Cloudflare Workers (API + Assets)   |
| Deployment  | Wrangler 4                          |

## Project Structure

```
src/
  worker.ts       # Cloudflare Workers entrypoint (Hono API + static asset fallback)
  main.tsx        # React app entry (mounts <App /> into #root)
  App.tsx         # Root React component
  App.css         # Component styles
  index.css       # Global CSS
  assets/         # Static assets (images, SVGs)
migrations/
  0001_init.sql   # D1 database schema (trips, days, items tables)
public/           # Vite public directory
index.html        # HTML entrypoint for Vite/React
wrangler.toml     # Cloudflare Workers + D1 configuration
vite.config.ts    # Vite bundler configuration
eslint.config.js  # ESLint flat config
tsconfig.json     # TypeScript project references root
tsconfig.app.json # TypeScript config for src/ (React app, strict)
tsconfig.node.json# TypeScript config for Vite tooling (Node)
```

## Commands

```bash
npm run dev        # Full-stack local dev (Workers + API + static assets via wrangler)
npm run dev:web    # Frontend-only dev server (Vite HMR, no API)
npm run build      # TypeScript type-check (tsc -b) then Vite production build
npm run deploy     # Build + deploy to Cloudflare
npm run lint       # Run ESLint
```

## Workflow Rules

### Automated Task Processing (課題リスト自動処理)

This project uses an automated task processing workflow. When starting a new session:

1. **Check current task list** — Review the TodoWrite task list (if any pending tasks exist)
2. **Process tasks sequentially** — Use subagents (`Task` tool with `subagent_type=general-purpose`) for each task
3. **Commit after each task** — Create a git commit with the standard format after completing each feature
4. **Apply migrations** — Run `npx wrangler d1 migrations apply trip-itinerary --remote` if database changes are made
5. **Push and deploy after batch** — After completing 2-4 tasks, push to remote and deploy
6. **Propose new features** — When the task list is empty, propose 4 new features and add them to the task list

#### Task Processing Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    START NEW SESSION                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Check TodoWrite for pending tasks                          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│  Tasks exist?           │     │  No tasks? Propose 4 new    │
│  → Process first task   │     │  features and add to list   │
└─────────────────────────┘     └─────────────────────────────┘
              │                               │
              ▼                               │
┌─────────────────────────────────────────────────────────────┐
│  Use Task tool with subagent to implement feature           │
│  - subagent_type: general-purpose                           │
│  - Include: DB migration, API, Frontend, CSS                │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Apply migrations if needed:                                │
│  npx wrangler d1 migrations apply trip-itinerary --remote   │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Commit with standard format:                               │
│  feat: <description>                                        │
│                                                             │
│  Generated with [Claude Code](https://claude.ai/code)       │
│  via [Happy](https://happy.engineering)                     │
│                                                             │
│  Co-Authored-By: Claude <noreply@anthropic.com>             │
│  Co-Authored-By: Happy <yesreply@happy.engineering>         │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Mark task as completed in TodoWrite                        │
│  Move to next pending task                                  │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  After 2-4 tasks: git push && npm run build && npx wrangler │
│  deploy                                                     │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  All tasks done? → Propose 4 new features                   │
│  More tasks? → Continue processing                          │
└─────────────────────────────────────────────────────────────┘
```

### Code Review with Codex (コードレビュー)

コード変更後、品質向上のためにCodexを使ったコードレビューを実行できます。

#### レビュー実行方法

```bash
# 変更差分のレビュー
npx codex review

# 特定ファイルのレビュー
npx codex review src/worker.ts

# セキュリティ重視のレビュー
npx codex review --focus security

# パフォーマンス重視のレビュー
npx codex review --focus performance
```

#### レビュー観点

1. **セキュリティ**
   - SQL injection, XSS, CSRF対策
   - 認証・認可の適切性
   - 機密情報の漏洩リスク

2. **パフォーマンス**
   - N+1クエリ問題
   - 不要な再レンダリング
   - メモリリーク

3. **コード品質**
   - TypeScriptの型安全性
   - エラーハンドリング
   - テスト容易性

4. **アクセシビリティ**
   - ARIA属性
   - キーボード操作
   - スクリーンリーダー対応

#### 自動レビュー設定

`.codex/config.json` で自動レビュー設定を管理:

```json
{
  "autoReview": {
    "onCommit": true,
    "focus": ["security", "typescript"],
    "exclude": ["*.test.ts", "*.spec.ts"]
  }
}
```

#### レビュー結果の活用

- Critical/High は必ず対応
- Medium は検討して判断
- Low/Info は参考情報として記録

#### Feature Proposal Guidelines

When proposing new features, consider:
- User experience improvements
- Missing core functionality
- Mobile/accessibility enhancements
- Performance optimizations
- Social/sharing features
- Data management features

Example feature categories:
- 検索・フィルター機能
- アーカイブ機能
- ダークモード
- 複製機能
- オフライン対応
- 通知機能
- 統計・分析機能

### Project Manager Agent (プロジェクトマネージャー)

新機能の提案時には、プロジェクトマネージャーエージェントを通して妥当性を検証します。

#### 使用方法

```
Task tool with subagent_type=general-purpose
prompt: "プロジェクトマネージャーとして以下の機能提案を評価してください: [機能リスト]"
```

#### 評価基準

プロジェクトマネージャーは以下の観点から機能を評価・却下します：

##### ✅ 採用すべき機能
1. **「作るだけで綺麗」を強化** — 入力→完成品の体験を向上させる
2. **限定共有の価値向上** — 招待された人の閲覧体験を良くする
3. **入力の手間を削減** — AI生成、テンプレート、音声入力など
4. **旅行の思い出を残す** — 写真、アルバム、振り返り機能
5. **シンプルで直感的** — 説明不要で使える

##### ❌ 却下すべき機能
1. **SNS化・公開前提の機能** — Holiday等との差別化ポイントを損なう
   - 例: フォロー機能、いいね、コメント欄公開、ランキング
2. **ツール感が出る機能** — 完成品感を損なう複雑なUI
   - 例: ガントチャート、複雑なフィルター、ダッシュボード過多
3. **アプリDL必須の機能** — Web完結の強みを損なう
   - 例: ネイティブ機能依存、重いバックグラウンド処理
4. **競合と同質化する機能** — 差別化ポイントを失う
   - 例: tabioriのようなチャット機能、複雑な権限管理
5. **コンセプトから外れる機能**
   - 例: 予約機能、決済機能（旅程作成とは別領域）
   - 例: ゲーミフィケーション、バッジ、ポイント制度

#### 評価フォーマット

```
## 機能評価レポート

### 提案された機能
1. [機能名]
2. [機能名]
...

### 評価結果

#### ✅ 採用推奨
- **[機能名]**: [理由]

#### ⚠️ 要検討
- **[機能名]**: [懸念点と改善案]

#### ❌ 却下
- **[機能名]**: [コンセプトに合わない理由]

### 推奨アクション
[最終的な提案リスト]
```

#### コンセプト再確認

このサービスの核心：
- **「作るだけで綺麗」** — テーマ選択 + 旅程入力だけで完成品
- **Web完結 × 招待リンク** — URLだけで閲覧可能
- **限定公開が前提** — 身内だけに共有
- **テキスト→AI自動生成** — 入力の手間を最小化

新機能は常にこの4点を強化する方向で検討すること。

## Architecture

### Backend (src/worker.ts)

- Single Cloudflare Worker handles both API and static asset serving
- Hono framework with typed environment bindings (`Bindings: { DB: D1Database, ASSETS, BUCKET: R2Bucket, AI: Ai }`)
- API routes under `/api/*`, all other requests fall through to static assets (`c.env.ASSETS.fetch`)
- D1 accessed via `c.env.DB.prepare(...).all()`
- R2 accessed via `c.env.BUCKET` (カバー画像保存)
- Workers AI accessed via `c.env.AI.run()` (旅程テキストパース)
- Current endpoints: `GET /api/health`, `GET /api/trips`

### Frontend (src/)

- Standard React + Vite setup with `react-jsx` transform
- Entry at `src/main.tsx` -> `src/App.tsx`
- Built output goes to `dist/` (served by Workers ASSETS binding)
- 2つのテーマ: 「しずか」（ミニマル）と「写真映え」（ビジュアル重視）

### Database (migrations/)

既存テーブル (TEXT primary keys, UUIDs):
- **trips**: id, title, start_date, end_date, created_at, updated_at
- **days**: id, trip_id (FK), date, sort
- **items**: id, trip_id (FK), day_id (FK), title, area, time_start, time_end, map_url, note, cost, sort, created_at, updated_at

MVP追加予定テーブル:
- **users**: id, provider (google/line), provider_id, name, avatar_url, created_at
- **share_tokens**: id, trip_id (FK), token (unique), is_active, created_at, expires_at

All foreign keys use `ON DELETE CASCADE`. Timestamps default to ISO 8601 via `strftime`.

### 実装フェーズ

```
Phase 1: 土台        — 認証 → DB/API → 旅行CRUD → 一覧画面
Phase 2: コア体験    — テーマ2種 → カバー画像アップ(R2) → 旅程入力UI
Phase 3: 差別化      — テキスト→旅程AI生成 → 招待リンク → OGP動的生成
Phase 4: 仕上げ      — LP → 全体の磨き込み
```

## Code Conventions

### TypeScript

- Strict mode enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- ES modules (`"type": "module"` in package.json)
- `erasableSyntaxOnly: true` — use `type` keyword for type-only imports/exports
- Target: ES2022, module: ESNext, bundler module resolution

### Hono API Pattern

- Define typed `Bindings` and `Variables` interfaces for Worker environment
- Use `AppEnv` type parameter on `new Hono<AppEnv>()`
- Access D1 via `c.env.DB`, assets via `c.env.ASSETS`
- Return JSON responses with `c.json()`

### ESLint

- Flat config format (ESLint 9+)
- Plugins: `typescript-eslint`, `react-hooks`, `react-refresh`
- Targets `**/*.{ts,tsx}`, ignores `dist/`

### Style

- No Prettier configured — follow existing code formatting conventions
- CSS files colocated in `src/` (App.css, index.css)

## Environment Setup

1. `npm install` to install dependencies
2. `npx wrangler login` for Cloudflare authentication
3. `npx wrangler d1 create trip-itinerary` to create the D1 database
4. Replace `database_id = "REPLACE_ME"` in `wrangler.toml` with actual ID
5. `npx wrangler d1 migrations apply trip-itinerary` to run migrations
6. Set up authentication secrets (see [docs/SETUP.md](docs/SETUP.md))

## Testing

No test framework is configured yet. When adding tests, Vitest is the recommended choice given the Vite-based build system.

## Deployment

`npm run deploy` builds the project and deploys to Cloudflare Workers. The `wrangler.toml` `database_id` must be set to a real D1 database ID before deploying.

## Design System — 2 Themes

### Theme 1: 「しずか」 (quiet) — ミニマル

Inspired by katasu.me. The design should feel calm, warm, and unhurried.

### Principles

1. **余白 (whitespace)** — generous spacing between elements; let content breathe
2. **控えめ (restraint)** — minimal UI elements; show only what's needed
3. **温かみ (warmth)** — warm off-white and brown tones, not cold/clinical white
4. **静けさ (stillness)** — no flashy animations; at most subtle fades (150–250ms ease)

### Color Tokens

| Token               | Value     | Usage                        |
|---------------------|-----------|------------------------------|
| `--color-bg`        | `#f6f3ee` | Page background (warm cream) |
| `--color-bg-elevated` | `#ffffff` | Cards, modals, elevated surfaces |
| `--color-text`      | `#3d2e1f` | Primary text (dark brown)    |
| `--color-text-muted`| `#8c7b6b` | Secondary text               |
| `--color-text-faint`| `#b5a899` | Tertiary / placeholder text  |
| `--color-border`    | `#d9d0c5` | Borders, dividers            |
| `--color-border-light` | `#e8e2da` | Subtle dividers           |
| `--color-accent`    | `#3d2e1f` | CTA buttons, active states   |
| `--color-accent-hover` | `#5a4636` | Hover state for accent    |

### Typography

- **Font stack:** `"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif`
- **Base line-height:** 1.8 (airy, readable)
- **Letter spacing:** 0.02em
- **Weights:** 400 (normal), 500 (medium), 600 (bold — use sparingly)
- **Font sizes:** 0.75rem (caption) → 0.8125rem (small) → 0.875rem (body) → 1rem (default) → 1.5rem (title)

### Spacing Scale (4px base)

`--space-1` (4px) through `--space-9` (96px). Use `--space-5` (24px) and above for section gaps, `--space-3` (12px) for tight element spacing.

### Component Patterns

- **Buttons:** Two styles — `.btn-outline` (thin border, transparent bg) and `.btn-filled` (accent bg, accent border). Both use `border-radius: 10px`.
- **Cards:** `.trip-card` — white bg, 1px `border-light`, `border-radius: 10px`. Hover darkens border subtly.
- **Layout:** Single-column, max-width 480px, centered. Header with thin bottom border. Footer minimal.
- **Empty states:** Centered, faint text, no heavy icons.
- **Timeline:** Grid layout with time column (56px) + content. Items separated by `border-light` lines.

### Do / Don't

- DO: use plenty of whitespace, thin borders, muted colors
- DO: keep text small and light; let hierarchy come from spacing not boldness
- DO: use Japanese-first copy (e.g. "あたらしい旅程" not "New Trip")
- DON'T: use shadows (box-shadow) — use borders instead
- DON'T: use bright/saturated accent colors
- DON'T: add animations beyond subtle opacity/color transitions
- DON'T: use icon libraries — use text and minimal symbols

### Theme 2: 「写真映え」 — ビジュアル重視

雑誌やトラベルブログのような見た目。カバー画像が主役。

#### Principles

1. **写真が主役** — カバー画像を大きく見せる。テキストは写真を引き立てる
2. **コントラスト** — しずかテーマより明暗差をつける
3. **雑誌的レイアウト** — 見出しや日付をタイポグラフィで演出

#### Color Tokens (写真映え)

| Token               | Value     | Usage                        |
|---------------------|-----------|------------------------------|
| `--color-bg`        | `#fafafa` | 明るいニュートラル背景        |
| `--color-bg-elevated` | `#ffffff` | カード                       |
| `--color-text`      | `#1a1a1a` | 濃いテキスト（コントラスト強） |
| `--color-text-muted`| `#6b6b6b` | 補助テキスト                 |
| `--color-accent`    | `#2a2a2a` | CTA、強調                    |

#### Component Patterns (写真映え)

- **カバー画像**: ページ上部に幅100%で表示、アスペクト比 16:9、角丸なし
- **タイトル**: カバー画像にオーバーレイ or 画像直下に大きめサイズ
- **タイムライン**: しずかと同じグリッドだが、フォントサイズやウェイトでメリハリ

### Theme共通ルール

- テーマはCSSカスタムプロパティの切り替えで実装
- `data-theme="shizuka"` / `data-theme="photo"` をルート要素に付与
- レイアウト構造は共通、色・フォント・カバー画像の扱いがテーマで変わる

## Important Notes

- The `wrangler.toml` `database_id` is a placeholder (`REPLACE_ME`) — D1 will not work without a real ID
- Authentication uses self-hosted OAuth (Google and LINE) — see [docs/SETUP.md](docs/SETUP.md)
- No CI/CD pipeline exists
- No Dockerfile or containerization — the app is Cloudflare-native
