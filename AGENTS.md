# ChronoMap 開発ガイド (AGENTS.md)

本ファイルは、ChronoMap プロジェクトにおけるビルド、実行、コードスタイル、およびコマンド実行のガイドラインを定義します。

## 開発コマンド

### 依存関係と環境構築
- **パッケージのインストール**: `npm install`
- **開発サーバーの起動**: `npm run dev`
- **プロダクションビルド**: `npm run build`
- **ビルド成果物のローカルプレビュー**: `npm run preview`

### コード検証
- **TypeScript 型チェック**: `npx tsc --noEmit`

---

## RTK (Rust Token Killer) の利用ルール
本プロジェクトでの Git 操作や CLI コマンドの実行時は、トークン節約のため `rtk` を経由して実行します。
- `rtk git status` などのようにコマンドの先頭に `rtk` を付与します（自動フックが有効な場合はそのまま実行します）。
- 使用履歴やトークン削減状況の確認は `rtk gain --history` を使用します。

---

## コードスタイルと設計ガイドライン

### 1. 技術構成
- **言語**: TypeScript (ロジック) & HTML (構造)
- **スタイリング**: Vanilla CSS (CSS変数を用いた設計システム、ダークモード、グラデーション、グラスモルフィズム効果)。TailwindCSS は明示的な指示がない限り使用しない。
- **データベース**: IndexedDB (`idb` ライブラリ) を用いたローカルファースト設計。

### 2. ディレクトリ・ファイル構成
- `/src/main.ts`: エントリーポイント、UIバインディング
- `/src/canvas.ts`: キャンバスレンダリング、ドラッグ・ズーム、インタラクション
- `/src/db.ts`: IndexedDB 保存ロジック
- `/src/playback.ts`: タイムライン制御、プレイバックロジック
- `/src/audio.ts`: 音声認識 (Web Speech API)
- `/src/sync.ts`: Google Drive (OAuth2) 同期

### 3. パフォーマンス要件
- 描画遅延は 16ms (60fps) 以内を維持する（Canvas レンダラーの最適化）。
- IndexedDB への画像保存時は、必要に応じてリサイズ等の圧縮処理を適用する。
