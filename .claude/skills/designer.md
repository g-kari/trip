# Designer Skill — 総合デザイナーエージェント

UIデザイン、CSS、テーマ、コンポーネント設計など、デザインに関するあらゆる相談に対応する総合デザイナースキル。

## Usage

`/designer [command] [target]`

### Commands

| Command | Description |
|---------|-------------|
| `review` | UIコンポーネント/CSSのデザインレビュー |
| `fix` | デザイン問題の修正提案と実装 |
| `create` | 新しいコンポーネントのデザイン作成 |
| `theme` | テーマの拡張・カスタマイズ |
| `audit` | プロジェクト全体のデザイン監査 |
| (なし) | 対話的にデザイン相談 |

## Instructions

### 1. デザインレビュー (`/designer review`)

指定されたコンポーネントやCSSファイルをガイドラインに基づいてレビュー。

```
/designer review src/App.css
/designer review src/components/TripCard.tsx
/designer review  # 最近変更されたファイルをレビュー
```

#### Review Checklist

**カラー (Colors)**
- `--color-*` トークンを使用しているか
- コントラスト比は十分か（WCAG AA準拠: 4.5:1）
- テーマ間で適切に動作するか（しずか / 写真映え / ダークモード）

**タイポグラフィ (Typography)**
- フォントサイズ: 0.75rem (caption) → 1.5rem (title)
- `--font-weight-*` トークンを使用
- `--line-height` (1.8) / `--letter-spacing` (0.02em)

**スペーシング (Spacing)**
- `--space-*` トークンを使用（4px基準）
- 余白は十分か（「しずか」は余白を大切にする）
- 要素間の間隔は一貫しているか

**ボーダーと角丸**
- `--color-border` / `--color-border-light`
- `--radius-s` (6px) / `--radius-m` (10px) / `--radius-l` (16px)
- box-shadow は使わない（ボーダーで代用）

**トランジション**
- `--transition-fast` (150ms) / `--transition-normal` (250ms)
- 派手なアニメーションは避ける

**レイアウト**
- `--content-width` (480px)
- 単一カラム、モバイルファースト

**アクセシビリティ**
- フォーカス状態が明確
- タッチターゲット最低44px
- 適切な見出し階層、aria属性

#### Output Format

```markdown
## デザインレビュー: [ファイル名]

### 評価: [A/B/C/D/E]

### 良い点
- ...

### 改善点
- ...

### 修正コード
```

---

### 2. デザイン修正 (`/designer fix`)

指摘された問題を修正。レビュー結果に基づいて自動修正も可能。

```
/designer fix src/App.css  # レビュー後に修正を適用
/designer fix spacing      # スペーシングの問題を修正
/designer fix colors       # カラートークンの問題を修正
```

---

### 3. コンポーネント作成 (`/designer create`)

新しいUIコンポーネントをデザインガイドラインに沿って作成。

```
/designer create button-group
/designer create modal
/designer create date-picker
```

#### コンポーネント作成の原則

1. **既存パターンを踏襲** — `.btn-outline`, `.btn-filled` などの既存スタイルを基盤に
2. **トークン優先** — 全ての値にデザイントークンを使用
3. **テーマ対応** — しずか / 写真映え / ダークモードで動作確認
4. **最小限** — 必要な機能のみ、over-engineering しない
5. **アクセシブル** — キーボード操作、スクリーンリーダー対応

---

### 4. テーマ拡張 (`/designer theme`)

既存テーマのカスタマイズや新テーマの作成。

```
/designer theme extend shizuka    # しずかテーマを拡張
/designer theme create minimal    # 新テーマ「minimal」を作成
/designer theme dark-mode         # ダークモード調整
```

#### 現在のテーマ

| Theme | Description | Key Colors |
|-------|-------------|------------|
| しずか (default) | ミニマル、温かみ | `#f6f3ee`, `#3d2e1f` |
| 写真映え (photo) | ビジュアル重視、コントラスト強 | `#1a1a2e`, `#e94560` |
| ダークモード | システム連動 | `#1a1a1a`, `#e8e8e8` |

---

### 5. デザイン監査 (`/designer audit`)

プロジェクト全体のデザイン一貫性をチェック。

```
/designer audit           # 全体監査
/designer audit colors    # カラーのみ監査
/designer audit spacing   # スペーシングのみ監査
```

#### 監査項目

- ハードコードされた色値の検出
- 非標準のスペーシング値
- box-shadow の使用箇所
- アクセシビリティ問題
- テーマ非対応のスタイル

---

## Design System Reference

### Color Tokens

```css
/* Base (Light - しずか) */
--color-bg:           #f6f3ee  /* 温かいクリーム背景 */
--color-bg-elevated:  #ffffff  /* カード、モーダル */
--color-text:         #3d2e1f  /* ダークブラウン */
--color-text-muted:   #8c7b6b  /* 補助テキスト */
--color-text-faint:   #b5a899  /* プレースホルダー */
--color-border:       #d9d0c5  /* ボーダー */
--color-border-light: #e8e2da  /* 薄いボーダー */
--color-accent:       #3d2e1f  /* CTA */
--color-accent-hover: #5a4636  /* ホバー */

/* Semantic */
--color-danger:       #b55050
--color-success:      #4a7c4a
--color-warning-text: #8b3030
```

### Spacing Scale (4px base)

```css
--space-1:  4px    --space-5: 24px
--space-2:  8px    --space-6: 32px
--space-3: 12px    --space-7: 48px
--space-4: 16px    --space-8: 64px
                   --space-9: 96px
```

### Typography Scale

```css
0.75rem   /* caption */
0.8125rem /* small */
0.875rem  /* body */
1rem      /* default */
1.5rem    /* title */
```

### Radius

```css
--radius-s:  6px   /* small elements */
--radius-m: 10px   /* buttons, cards */
--radius-l: 16px   /* large cards, modals */
```

### Transitions

```css
--transition-fast:   150ms ease  /* hover states */
--transition-normal: 250ms ease  /* open/close */
```

---

## 「しずか」テーマ原則

### DO ✓

- 余白を十分に取る（コンテンツを呼吸させる）
- 控えめなUI（必要最小限の要素のみ）
- 温かみのある色調（オフホワイト、ブラウン）
- 静かなインタラクション（フェード、色変化のみ）
- テキストとミニマルなシンボルで表現

### DON'T ✗

- box-shadow を使う（ボーダーで代用）
- 彩度の高い色を使う
- 派手なアニメーション
- アイコンライブラリを使う
- 過度な装飾

---

## Examples

```
/designer                          # 対話的にデザイン相談
/designer review                   # 最近の変更をレビュー
/designer review src/App.css       # 特定ファイルをレビュー
/designer fix                      # レビュー結果を修正
/designer create card-skeleton     # スケルトンカードを作成
/designer theme dark-mode          # ダークモードを調整
/designer audit                    # 全体監査
```
