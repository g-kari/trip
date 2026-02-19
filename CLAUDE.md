# CLAUDE.md

This file provides guidance for AI assistants working on the **trip-itinerary** codebase.

## Project Overview

A travel itinerary web app (Japanese: 旅程) for managing and sharing day-by-day trip timelines. Runs entirely on Cloudflare's platform (Workers + D1 + Assets). Currently in early MVP stage.

**Core features (planned):** Day-based timeline management, spot memos/budgets/map links, token-based sharing URLs, PDF/print export.

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Language    | TypeScript (strict mode, ES2022)    |
| Frontend    | React 19 + Vite 7                   |
| Backend/API | Cloudflare Workers + Hono 4         |
| Database    | Cloudflare D1 (SQLite)              |
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

## Architecture

### Backend (src/worker.ts)

- Single Cloudflare Worker handles both API and static asset serving
- Hono framework with typed environment bindings (`Bindings: { DB: D1Database, ASSETS }`)
- API routes under `/api/*`, all other requests fall through to static assets (`c.env.ASSETS.fetch`)
- D1 accessed via `c.env.DB.prepare(...).all()`
- Current endpoints: `GET /api/health`, `GET /api/trips`

### Frontend (src/)

- Standard React + Vite setup with `react-jsx` transform
- Entry at `src/main.tsx` -> `src/App.tsx`
- Built output goes to `dist/` (served by Workers ASSETS binding)
- Frontend has a "しずか" (quiet) design with trip list and day timeline views (sample data)

### Database (migrations/)

Three tables with TEXT primary keys (UUIDs):
- **trips**: id, title, start_date, end_date, created_at, updated_at
- **days**: id, trip_id (FK), date, sort
- **items**: id, trip_id (FK), day_id (FK), title, area, time_start, time_end, map_url, note, cost, sort, created_at, updated_at

All foreign keys use `ON DELETE CASCADE`. Timestamps default to ISO 8601 via `strftime`.

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

## Testing

No test framework is configured yet. When adding tests, Vitest is the recommended choice given the Vite-based build system.

## Deployment

`npm run deploy` builds the project and deploys to Cloudflare Workers. The `wrangler.toml` `database_id` must be set to a real D1 database ID before deploying.

## Design System — "しずか" (quiet) aesthetic

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

## Important Notes

- The `wrangler.toml` `database_id` is a placeholder (`REPLACE_ME`) — D1 will not work without a real ID
- The React frontend has basic UI with sample data; needs API integration
- There is no authentication yet — token-based sharing is planned
- No CI/CD pipeline exists
- No Dockerfile or containerization — the app is Cloudflare-native
