# CLAUDE.md

## Project Overview

テーマを選んで旅程を入力するだけで、そのまま人に見せられる綺麗なページが完成する旅行共有Webサービス。Cloudflareプラットフォーム上で完結（Workers + D1 + R2 + Assets）。

**コンセプト:** 「作るだけで綺麗」な旅程ページを招待リンクで限定共有。Web完結でアプリDL不要。

実装済み機能は [docs/FEATURES.md](docs/FEATURES.md) を参照。

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
| Hosting     | Cloudflare Workers (API + Assets)   |
| Deployment  | Wrangler 4                          |

## Project Structure

```
src/
  worker.ts       # Workers entrypoint (Hono API + static asset fallback)
  main.tsx        # React app entry
  App.tsx         # Root React component
  types.ts        # Shared TypeScript types
  styles/         # CSS (components/, pages/, base/)
  components/     # React components
  pages/          # Page components
  hooks/          # Custom hooks
  auth/           # OAuth logic
migrations/       # D1 database migrations
public/           # Vite public directory
docs/             # Project documentation
```

## Commands

```bash
npm run dev        # Full-stack local dev (wrangler)
npm run build      # ESLint + tsc + Vite production build
npm run deploy     # Build + deploy to Cloudflare
npm run lint       # Run ESLint
```

## Workflow Rules

### Automated Task Processing

1. **Check TodoWrite** for pending tasks at session start
2. **Process tasks** using subagents (`Task` tool, `subagent_type=general-purpose`)
3. **Commit after each task** with standard format (see below)
4. **Apply migrations** if DB changes: `npx wrangler d1 migrations apply trip-itinerary --remote`
5. **Push and deploy** after 2-4 tasks: `git push && npm run deploy`
6. **Propose new features** when task list is empty (4 features, validate with `/project-manager` skill)

### Commit Format

```
feat: <description>

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
```

### Available Skills (`.claude/skills/<name>/SKILL.md`)

- `/review` — Codex によるコードレビュー（手動呼び出しのみ）
- `/designer` — デザインレビュー・修正・作成・テーマ・監査（自動/手動）
- `/project-manager` — 新機能提案の評価・コンセプト適合性判定（手動呼び出しのみ、fork実行）

## Architecture

### Backend (`src/worker.ts`)

- Hono framework with bindings: `{ DB: D1Database, ASSETS, BUCKET: R2Bucket, AI: Ai }`
- API routes: `/api/*`, static assets: fallback to `c.env.ASSETS.fetch`
- Auth: session-based, `c.get('user')` でユーザー取得
- Permission helpers: `checkTripOwnership()` (owner-only), `checkCanEditTrip()` (owner+editor)

### Frontend (`src/`)

- React 19 + Vite, built to `dist/`
- 3テーマ: 「しずか」/ 「写真映え」/ 「レトロ」+ ダークモード
- デザインガイドラインは `/designer` スキルを参照

### Database

TEXT primary keys (UUID), `ON DELETE CASCADE`, ISO 8601 timestamps (`strftime`)。
スキーマは `migrations/` ディレクトリの SQL ファイルを参照。

## Code Conventions

- **TypeScript**: strict mode, ES2022, `erasableSyntaxOnly: true` (use `type` keyword for type-only imports)
- **Hono**: typed `AppEnv`, `c.env.DB.prepare().bind().all()`, `c.json()` for responses
- **ESLint**: flat config (ESLint 9+), plugins: `typescript-eslint`, `react-hooks`, `react-refresh`
- **CSS**: コンポーネント別ファイル in `src/styles/`, デザイントークン (`--color-*`, `--space-*`) を使用
- **UI言語**: Japanese-first（「あたらしい旅程」not "New Trip"）
- **Shadows禁止**: box-shadow は使わず border で代用

## Environment Setup

[docs/SETUP.md](docs/SETUP.md) を参照。
`wrangler.toml` の `database_id` は実際のD1 ID に置き換えが必要。

## Important Notes

- Authentication: 自前OAuth (Google / LINE) — see [docs/SETUP.md](docs/SETUP.md)
- No CI/CD, no Docker — Cloudflare-native
- No test framework yet (Vitest recommended)
