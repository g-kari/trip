# CLAUDE.md

This file provides guidance for AI assistants working on the **trip-itinerary** codebase.

## Project Overview

テーマを選んで旅程を入力するだけで、そのまま人に見せられる綺麗なページが完成する旅行共有Webサービス。Cloudflareプラットフォーム上で完結（Workers + D1 + R2 + Assets）。

**コンセプト:** 「作るだけで綺麗」な旅程ページを招待リンクで限定共有。Web完結でアプリDL不要。

### MVP機能

1. **ランディングページ** — サービス紹介
2. **Google / LINE ログイン** — ソーシャル認証
3. **旅行一覧・作成** — 1旅行 = 1つの縦長ページ
4. **テーマ選択（2種）** — 「しずか」（ミニマル） / 「写真映え」（ビジュアル重視）
5. **テキスト→旅程AI生成** — テキスト貼り付けで自動パース（Workers AI）
6. **カバー画像アップロード** — 写真映えテーマ用、1枚（R2保存）
7. **招待リンク** — トークンベース、無効化・再発行可能
8. **OGP動的プレビュー** — LINE/X共有時にテーマ連動の綺麗なカード生成

### 将来の追加機能

- 有料化（追加旅行 ¥100/ページ、MVP期間は無料）
- 写真アルバム（複数枚アップロード）
- デザイン変更・テーマ追加
- 旅程AI解析（周辺情報・店舗情報チップス表示）
- PWA / オフライン対応

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

### Pre-commit Review (REQUIRED)

Before creating any git commit, you MUST run codex to review the changes:

```bash
codex review --uncommitted "Check for bugs, security issues, and code quality"
```

Only proceed with the commit if codex reports no critical issues. If issues are found, fix them first.

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
