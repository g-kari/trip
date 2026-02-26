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
| 旅行一覧・作成 | 1旅行 = 1つの縦長ページ |
| テーマ選択（2種） | 「しずか」（ミニマル）/「写真映え」（ビジュアル重視） |
| ダークモード | ライト/ダーク/システム設定に対応 |
| テキスト→旅程AI生成 | メモやテキストを貼り付けると自動で旅程に変換 |
| カバー画像アップロード | 写真映えテーマ用、R2保存 |
| 招待リンク | 無効化・再発行可能なトークンベース共有 |
| OGP動的プレビュー | LINE/X共有時に綺麗なカードを自動生成 |
| コラボレーター機能 | 複数人での旅程編集 |
| フィードバック | 星評価とコメント |
| 予算管理 | カテゴリ別費用トラッキング |
| 持ち物リスト | カテゴリ分け、チェック機能付き |
| 写真アルバム | 日程・予定ごとの複数枚アップロード |
| 統計ページ | 旅行履歴の可視化 |
| 印刷対応 | 印刷用スタイル |

## 将来の追加機能

- 有料化（追加旅行 ¥100/ページ）
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
| AI | Cloudflare Workers AI (旅程パース) |
| Auth | 自前OAuth (Google / LINE) |
| OGP生成 | Satori (Workers上で動的生成) |
| Hosting | Cloudflare Workers (API + Assets) |
| Deployment | Wrangler 4 |

## 構成

```
src/
  worker.ts         # Workers entrypoint (Hono API + 静的配信)
  main.tsx          # React entry
  components/       # Reactコンポーネント
  pages/            # ページコンポーネント
  hooks/            # カスタムフック
  styles/           # CSSモジュール
    base/           # tokens, themes, reset, responsive
    components/     # コンポーネント別CSS
    pages/          # ページ別CSS
migrations/         # D1 migration (SQL)
public/             # Vite public directory
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
npm run dev:web    # Frontend only (Vite HMR)
npm run build      # Type-check + Vite build
npm run lint       # ESLint
npx wrangler deploy # Cloudflareへデプロイ
```
