# ChronoMap

ChronoMap は、マインドマップベースのローカルファースト思考記録 Web アプリケーションです。
オフラインで快適に動作し、音声入力や画像添付、タイムラインによる時間軸のコントロールが可能です。また、Google Drive を介して複数デバイス間でのデータ同期もサポートします。

---

## 主な機能

- **無限キャンバス**: ドラッグ＆ドロップでの移動、ホイールによるズーム、ノードのドラッグ操作。
- **思考の視覚化 (マインドマップ)**: ノードの追加・編集・接続 (ドラッグでのリレーション構築)、スタイリッシュなダークテーマ。
- **タイムラインとプレイバック**: 作成された思考の履歴をアニメーションで再生可能（可変速、フィルタリング対応）。
- **メディア連携**: ノードごとに「音声メモ（音声テキスト自動文字起こし）」および「写真（最大1024pxに圧縮して保存）」を添付可能。
- **ローカルファースト (IndexedDB)**: データはすべてブラウザ内に保存されるため、完全にオフラインで動作します。
- **PWA (Progressive Web App)**: モバイルやPCにアプリとしてインストール可能です。
- **Google Drive 同期 (OAuth2)**: クラウドの `appDataFolder` 領域を介してマージ同期。同一データの編集競合時には `updatedAt` の新しさを元に自動マージされます。

---

## 開発環境のセットアップ

### 必要な環境
- Node.js (v20以上推奨)
- npm

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数の設定 (Google Drive 同期用)
1. ルートディレクトリの `.env.example` をコピーして `.env.local` を作成します。
   ```bash
   cp .env.example .env.local
   ```
2. [Google Cloud Console](https://console.cloud.google.com/) で「OAuth 2.0 クライアント ID」（ウェブ アプリケーション型）を作成します。
   - **承認された JavaScript 生成元**: `http://localhost:3000` などのローカル開発URLと、本番用のGitHub Pagesドメイン (`https://<username>.github.io`) を設定します。
   - **承認されたリダイレクト URI**: 空欄でOKです。
3. 発行されたクライアントIDを `.env.local` の `VITE_GOOGLE_CLIENT_ID` に設定します。
   ```env
   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ```

### 3. 開発サーバーの起動
```bash
npm run dev
```
起動後、ブラウザで `http://localhost:3000` にアクセスします。

---

## ビルドとプレビュー

本番向け静的ファイルの出力と、ローカルプレビューの手順です。

### 本番ビルド
```bash
npm run build
```
ビルドに成功すると `dist/` ディレクトリに HTML / CSS / JS および PWA 用サービスワーカー（Service Worker）が出力されます。

### ローカルでのプレビュー
```bash
npm run preview
```
ビルド後の成果物をローカルサーバーでサーブします（通常 `http://localhost:4173` で起動）。

---

## デプロイ (GitHub Pages)

本プロジェクトには、GitHub Pages への自動デプロイワークフローが含まれています。

1. **GitHub の環境変数設定**:
   - リポジトリの **Settings** > **Secrets and variables** > **Actions** > **Variables** タブを開きます。
   - `VITE_GOOGLE_CLIENT_ID` という変数名で、取得した本番用の Google OAuth クライアントID を登録します。
2. **GitHub Pages のソース設定**:
   - リポジトリの **Settings** > **Pages** タブを開きます。
   - **Build and deployment** の **Source** を `GitHub Actions` に設定します。
3. **Pushによる自動デプロイ**:
   - `main` ブランチにプッシュすると、GitHub Actions が自動的にビルドを開始し、GitHub Pages へデプロイします。
