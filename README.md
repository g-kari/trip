# trip-itinerary

テーマを選んで旅程を入れるだけで、そのまま人に見せられる綺麗なページが完成する旅行共有サービス。
**Cloudflareだけで完結**（Workers + D1 + R2 + Assets）。

## コンセプト

- 「作るだけで綺麗」— テーマを選んで旅程を入力したら、もう完成品
- 招待リンクで限定公開 — URLを知っている人だけがアクセス可能
- Web完結 — アプリDL不要、ブラウザだけで作成・閲覧

## MVP機能

| 機能 | 説明 |
|------|------|
| ランディングページ | サービス紹介 |
| Google / LINE ログイン | ソーシャル認証 |
| 旅行一覧・作成 | 1旅行 = 1つの縦長ページ |
| テーマ選択（2種） | 「しずか」（ミニマル）/「写真映え」（ビジュアル重視） |
| テキスト→旅程AI生成 | メモやテキストを貼り付けると自動で旅程に変換 |
| カバー画像アップロード | 写真映えテーマ用、1枚 |
| 招待リンク | 無効化・再発行可能なトークンベース共有 |
| OGP動的プレビュー | LINE/X共有時に綺麗なカードを自動生成 |

## 将来の追加機能

- 有料化（追加旅行 ¥100/ページ）
- 写真アルバム（複数枚アップロード）
- デザイン変更・テーマ追加
- 旅程のAI解析（周辺情報・店舗情報をチップス表示）
- PWA / オフライン対応

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict, ES2022) |
| Frontend | React 19 + Vite 7 |
| Backend/API | Cloudflare Workers + Hono 4 |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 (画像) |
| AI | Claude API (旅程パース) |
| Auth | 未定 (Clerk or 自前OAuth) |
| OGP生成 | Satori等 (Workers上) |
| Hosting | Cloudflare Workers (API + Assets) |
| Deployment | Wrangler 4 |

## 構成

```
src/
  worker.ts       # Workers entrypoint (Hono API + 静的配信)
  main.tsx        # React entry
  App.tsx         # Root component
  App.css         # Component styles
  index.css       # Global CSS
  assets/         # Static assets
migrations/       # D1 migration (SQL)
public/           # Vite public directory
```

## セットアップ

```bash
npm install                                          # 依存関係
npx wrangler login                                   # Cloudflare認証
npx wrangler d1 create trip-itinerary                # D1作成
# → wrangler.toml の database_id を置き換え
npx wrangler d1 migrations apply trip-itinerary      # マイグレーション適用
```

## 開発

```bash
npm run dev        # Full-stack (Workers + API + Assets)
npm run dev:web    # Frontend only (Vite HMR)
npm run build      # Type-check + Vite build
npm run deploy     # Build + Cloudflareへデプロイ
npm run lint       # ESLint
```

## 実装フェーズ

```
Phase 1: 土台
  認証 → DB/API → 旅行CRUD → 一覧画面

Phase 2: コア体験
  テーマ2種 → カバー画像アップ(R2) → 旅程入力UI

Phase 3: 差別化
  テキスト→旅程AI生成 → 招待リンク → OGP動的生成

Phase 4: 仕上げ
  LP → 全体の磨き込み
```

## 注意

- `wrangler.toml` の `database_id` 未設定のままだとD1が動かない
- 認証方式（Clerk vs 自前OAuth）は未決定
