# trip-itinerary

テーマを選んで旅程を入れるだけで、そのまま人に見せられる綺麗なページが完成する旅行共有サービス。
**Cloudflareだけで完結**（Workers + D1 + R2 + Assets）。

## コンセプト

- 「作るだけで綺麗」— テーマを選んで旅程を入力したら、もう完成品
- 招待リンクで限定公開 — URLを知っている人だけがアクセス可能
- Web完結 — アプリDL不要、ブラウザだけで作成・閲覧

## 実装済み機能

| 機能 | 説明 |
|------|------|
| ランディングページ | サービス紹介 |
| Google / LINE ログイン | 自前OAuth実装 |
| 旅行一覧・作成 | 1旅行 = 1つの縦長ページ、検索・フィルター・ソート |
| テーマ選択（4種） | 「しずか」/「写真映え」/「レトロ」/「ナチュラル」+ ダークモード |
| AI旅程生成 | 目的地・日程・スタイルを指定して自動生成（Llama 3.3 70B） |
| カバー画像 | R2保存、OGP連動 |
| 招待リンク共有 | トークンベース、無効化・再発行可能 |
| OGP動的プレビュー | テーマ連動カード（日数・エリア表示） |
| コラボレーター | オーナー/編集者/閲覧者の権限管理 |
| 予算・経費分割 | カテゴリ別費用、割り勘計算、精算サマリー |
| 持ち物リスト | カテゴリ別チェックリスト、進捗バー |
| 写真アルバム | アイテム・日程ごとの複数枚アップロード、自動レイアウト |
| 天気予報 | 直近14日間の日程に天気アイコンを表示 |
| 統計ページ | 旅行履歴・費用・訪問地の可視化 |
| 印刷・エクスポート | 印刷用スタイル、iCal/JSON/CSVエクスポート |
| PWA | オフライン表示、ホーム画面追加 |

詳細は [docs/FEATURES.md](docs/FEATURES.md) を参照。

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict, ES2022) |
| Frontend | React 19 + Vite 7 |
| Backend/API | Cloudflare Workers + Hono 4 |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 (画像) |
| AI | Cloudflare Workers AI (Llama 3.3 70B + LLaVA) |
| Auth | 自前OAuth (Google / LINE) |
| OGP生成 | Satori + resvg-wasm (Workers上で動的PNG生成) |
| Hosting | Cloudflare Workers (API + Assets) |
| Deployment | Wrangler 4 |

## 構成

```
src/
  worker.ts         # Workers entrypoint (Hono API + 静的配信)
  routes/           # APIルート分割
    auth.ts         # OAuth・セッション・プロフィール
    sharing.ts      # 共有リンク・コラボレーター・OGP
    expenses.ts     # 経費分割・精算・Stripe
    templates.ts    # 旅程/アイテムテンプレート
    feedback.ts     # フィードバック
    packing.ts      # 持ち物リスト
  helpers.ts        # 共通ヘルパー（認証チェック・AI・天気等）
  ogp.ts            # OGP画像生成（Satori + resvg）
  main.tsx          # React entry
  components/       # Reactコンポーネント
  pages/            # ページコンポーネント
  hooks/            # カスタムフック
  styles/           # CSS
    base/           # tokens, themes, reset, responsive
    components/     # コンポーネント別CSS
    pages/          # ページ別CSS
    themes/         # テーマ固有CSS（retro, natural）
migrations/         # D1 migration (SQL)
public/             # Vite public directory
docs/               # ドキュメント
```

## セットアップ

```bash
npm install                                          # 依存関係
npx wrangler login                                   # Cloudflare認証
npx wrangler d1 create trip-itinerary                # D1作成
# → wrangler.toml の database_id を置き換え
npx wrangler d1 migrations apply trip-itinerary      # マイグレーション適用
```

認証の設定は [docs/SETUP.md](docs/SETUP.md) を参照。

## 開発

```bash
npm run dev        # Full-stack (Workers + API + Assets)
npm run build      # ESLint + tsc + Vite build
npm run deploy     # Build + deploy to Cloudflare
npm run lint       # ESLint
```
