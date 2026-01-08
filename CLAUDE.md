# プロジェクト設定

## 基本設定
```yaml
プロジェクト名: サーバーバックアップ自動化ツール
開始日: 2026-01-08
技術スタック:
  frontend: React 18 + TypeScript 5 + Tailwind CSS
  backend: Rust + Tauri 2.x
  database: ローカルファイル（TOML + OS キーチェーン）
```

## 開発環境
```yaml
ポート設定:
  # 複数プロジェクト並行開発のため、一般的でないポートを使用
  frontend: 3347
  backend: 8547
  database: なし（ローカルファイル）

環境変数:
  設定ファイル: .env.local（ルートディレクトリ）
  必須項目:
    - SSH_KEY_PATH（開発用秘密鍵パス）
    - BACKUP_TEST_HOST（テスト用サーバー）
```

## テスト認証情報
```yaml
開発用SSH設定:
  hostname: test-server.local
  port: 10022
  username: test-user
  key_path: ~/.ssh/backup_tool_dev_key

外部サービス:
  エックスサーバー: SSH公開鍵認証（本番環境のみ）
  GitHub: リポジトリ管理・配布用（オプション）
```

## コーディング規約

### 命名規則
```yaml
ファイル名:
  - コンポーネント: PascalCase.tsx (例: BackupProgress.tsx)
  - ユーティリティ: camelCase.ts (例: sftpClient.ts)
  - 定数: UPPER_SNAKE_CASE.ts (例: SSH_CONFIG.ts)

変数・関数:
  - 変数: camelCase
  - 関数: camelCase
  - 定数: UPPER_SNAKE_CASE
  - 型/インターフェース: PascalCase
```

### コード品質
```yaml
必須ルール:
  - TypeScript: strictモード有効
  - 未使用の変数/import禁止
  - console.log本番環境禁止
  - エラーハンドリング必須
  - 関数行数: 100行以下（96.7%カバー）
  - ファイル行数: 700行以下（96.9%カバー）
  - 複雑度(McCabe): 10以下
  - 行長: 120文字

フォーマット:
  - インデント: スペース2つ
  - セミコロン: あり
  - クォート: シングル
```

## プロジェクト固有ルール

### Tauriコマンド
```yaml
命名規則:
  - Rustコマンド: snake_case（例: start_backup）
  - フロントエンド呼び出し: camelCase（例: startBackup）

エラーハンドリング:
  - Rust側: Result<T, String>を必ず使用
  - フロントエンド: try-catchで包む
```

### SSH/SFTP処理
```yaml
セキュリティ:
  - 認証情報はOS標準キーチェーンのみ保存
  - 秘密鍵パスは絶対パスで指定
  - 接続タイムアウト: 30秒
  - リトライ回数: 最大3回

エラーログ:
  - パスワード・秘密鍵の内容をログ出力禁止
  - 接続エラーは分類別にエラーコード付与
```

### 型定義
```yaml
配置:
  frontend: src/types/index.ts
  backend: src-tauri/src/types.rs

同期ルール:
  - フロントエンド・バックエンド間のデータ型は一致させる
  - serde_jsonでシリアライズ可能な型のみ使用
```

## 🆕 最新技術情報（知識カットオフ対応）
```yaml
# Web検索で解決した破壊的変更を記録
Tauri 2.x:
  - セキュリティ強化によりCSPデフォルト有効
  - 新しいプラグインシステム採用
  - tauri-plugin-keyring使用推奨

SSH接続:
  - エックスサーバーはポート10022固定
  - 公開鍵認証のみ対応（パスワード認証廃止）
  - OpenSSH形式の秘密鍵を使用
```

## MVP制約事項
```yaml
実装必須機能:
  - P-001: メインページ（バックアップ実行）
  - P-002: 設定ページ

実装禁止機能（Phase 11まで延期）:
  - 自動スケジューラー
  - バックアップ履歴表示
  - 複数プロファイル管理
  - 差分バックアップ（rsync）
  - 圧縮オプション

目標:
  - 2週間以内に動作するMVPを完成
  - 3クリック以内でバックアップ完了
  - 技術知識ゼロでも5分で設定完了
```