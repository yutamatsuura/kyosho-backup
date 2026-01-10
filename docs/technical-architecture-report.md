# サーバーバックアップ自動化ツール - 技術アーキテクチャ調査レポート

**作成日**: 2026-01-10
**調査対象**: Tauri 2.x + Rust + React 18 + TypeScript 5
**目的**: MVP開発のための最適なアーキテクチャ設計

---

## エグゼクティブサマリー

本レポートは、サーバーバックアップ自動化ツールの技術スタック選定と実装方針を調査し、以下を推奨します:

- **SSH/SFTP**: `ssh2-rs` + 独自リトライロジック
- **認証情報管理**: `tauri-plugin-keyring` (OSネイティブキーチェーン統合)
- **型安全性**: `TauRPC` + `Specta` によるRust-TypeScript自動型生成
- **エラーハンドリング**: `thiserror` (ライブラリ層) + `anyhow` (アプリケーション層)

---

## 1. Tauri 2.x セキュリティアーキテクチャ

### 1.1 Content Security Policy (CSP)

Tauri 2.xは **デフォルトでCSPを自動注入** し、XSS攻撃を防ぎます:

```json
{
  "tauri": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

#### 重要な変更点
- **コンパイル時CSP解析**: すべてのフロントエンドアセットを解析し、nonceとハッシュを自動注入
- **警告**: CSPを無効化するとXSS攻撃に脆弱になる
- **WebAssembly対応**: Rustフロントエンドを使用する場合は `'wasm-unsafe-eval'` を追加

### 1.2 新しいCapabilitiesシステム

```toml
# src-tauri/capabilities/ssh-backup.toml
identifier = "ssh-backup"
description = "SSH/SFTP接続とファイル操作の権限"
windows = ["main"]

[[permissions]]
identifier = "fs:read-file"
allow = ["/Users/*/backup_destination/*"]

[[permissions]]
identifier = "keyring:read-password"
allow = ["ssh_credentials"]
```

#### 設計方針
- **最小権限原則**: 必要な機能のみ有効化
- **ファイル単位管理**: `src-tauri/capabilities/`内で個別定義
- **JSONスキーマ自動生成**: IDEで自動補完可能

---

## 2. SSH/SFTP実装パターン

### 2.1 ライブラリ比較

| ライブラリ | 同期/非同期 | 依存関係 | SFTPサポート | 推奨度 |
|-----------|-----------|---------|-------------|--------|
| **ssh2-rs** | 同期 | libssh2 (C) + OpenSSL | ✅ | ⭐⭐⭐⭐⭐ |
| russh | 非同期 (Tokio) | Pure Rust | ✅ | ⭐⭐⭐ |
| openssh-sftp-client | 非同期 | Pure Rust | ✅ (v3のみ) | ⭐⭐ |

### 2.2 推奨実装: ssh2-rs

#### 選定理由
1. **安定性**: libssh2の成熟したバインディング
2. **エックスサーバー対応**: OpenSSH形式秘密鍵サポート
3. **同期処理の単純さ**: MVPに最適
4. **豊富なドキュメント**: 2025年現在も活発にメンテナンス

#### 実装例

```rust
// src-tauri/src/ssh/client.rs
use ssh2::Session;
use std::path::Path;
use std::net::TcpStream;
use anyhow::{Context, Result};

pub struct SshClient {
    session: Session,
}

impl SshClient {
    pub fn connect(
        host: &str,
        port: u16,
        username: &str,
        private_key_path: &Path,
    ) -> Result<Self> {
        // 1. TCP接続 (タイムアウト30秒)
        let tcp = TcpStream::connect_timeout(
            &format!("{}:{}", host, port).parse()?,
            std::time::Duration::from_secs(30),
        )
        .context("TCP接続失敗")?;

        // 2. SSH2セッション初期化
        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);
        session.handshake()
            .context("SSHハンドシェイク失敗")?;

        // 3. 公開鍵認証
        session
            .userauth_pubkey_file(
                username,
                None,
                private_key_path,
                None, // パスフレーズなし
            )
            .context("SSH認証失敗")?;

        Ok(Self { session })
    }

    pub fn download_file(
        &self,
        remote_path: &str,
        local_path: &Path,
    ) -> Result<u64> {
        let sftp = self.session.sftp()
            .context("SFTPセッション開始失敗")?;

        let mut remote_file = sftp.open(Path::new(remote_path))
            .context("リモートファイル開けません")?;

        let mut local_file = std::fs::File::create(local_path)
            .context("ローカルファイル作成失敗")?;

        std::io::copy(&mut remote_file, &mut local_file)
            .context("ファイルコピー失敗")
    }
}
```

### 2.3 リトライロジック

```rust
// src-tauri/src/ssh/retry.rs
use std::time::Duration;
use anyhow::Result;

pub async fn retry_with_backoff<F, T>(
    mut operation: F,
    max_retries: u32,
) -> Result<T>
where
    F: FnMut() -> Result<T>,
{
    let mut attempt = 0;
    loop {
        match operation() {
            Ok(result) => return Ok(result),
            Err(e) if attempt >= max_retries => return Err(e),
            Err(_) => {
                attempt += 1;
                let wait_time = Duration::from_secs(2u64.pow(attempt));
                tokio::time::sleep(wait_time).await;
            }
        }
    }
}
```

### 2.4 エックスサーバー特化設定

```rust
// src-tauri/src/ssh/config.rs
pub const XSERVER_SSH_PORT: u16 = 10022;
pub const CONNECTION_TIMEOUT_SECS: u64 = 30;
pub const MAX_RETRIES: u32 = 3;

/// エックスサーバー接続設定
pub struct XServerConfig {
    pub hostname: String,
    pub username: String,
    pub private_key_path: PathBuf,
}

impl Default for XServerConfig {
    fn default() -> Self {
        Self {
            hostname: String::new(),
            username: String::new(),
            private_key_path: dirs::home_dir()
                .unwrap()
                .join(".ssh/xserver_backup_key"),
        }
    }
}
```

---

## 3. OSキーチェーン統合

### 3.1 tauri-plugin-keyring

#### アーキテクチャ
```
┌─────────────────────────────────────────────────────┐
│         TypeScript Frontend                         │
│  import { getPassword, setPassword } from 'keyring' │
└─────────────────────────────────────────────────────┘
                         ↓ IPC
┌─────────────────────────────────────────────────────┐
│         Rust Backend (tauri-plugin-keyring)        │
│  app.keyring().get_password(service, user)?        │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              OS Keychain                            │
│  macOS: Keychain  Windows: Credential Manager      │
│  Linux: GNOME Keyring / Secret Service             │
└─────────────────────────────────────────────────────┘
```

### 3.2 実装例

#### フロントエンド (TypeScript)

```typescript
// src/utils/credentialManager.ts
import {
  getPassword,
  setPassword,
  deletePassword
} from 'tauri-plugin-keyring-api';

const SERVICE_NAME = 'backup-tool-ssh';

export class CredentialManager {
  async saveCredentials(
    serverId: string,
    username: string
  ): Promise<void> {
    const keyPath = await window.__TAURI__.dialog.open({
      filters: [{ name: 'SSH Key', extensions: ['pem', 'pub'] }],
    });

    if (keyPath) {
      await setPassword(
        SERVICE_NAME,
        `${serverId}:keypath`,
        keyPath as string
      );
      await setPassword(
        SERVICE_NAME,
        `${serverId}:username`,
        username
      );
    }
  }

  async getKeyPath(serverId: string): Promise<string | null> {
    return await getPassword(SERVICE_NAME, `${serverId}:keypath`);
  }

  async deleteCredentials(serverId: string): Promise<void> {
    await deletePassword(SERVICE_NAME, `${serverId}:keypath`);
    await deletePassword(SERVICE_NAME, `${serverId}:username`);
  }
}
```

#### バックエンド (Rust)

```rust
// src-tauri/src/credentials.rs
use tauri::Manager;
use tauri_plugin_keyring::KeyringExt;
use anyhow::{Context, Result};

const SERVICE_NAME: &str = "backup-tool-ssh";

pub fn get_ssh_key_path(
    app: &tauri::AppHandle,
    server_id: &str
) -> Result<String> {
    let key = format!("{}:keypath", server_id);

    app.keyring()
        .get_password(SERVICE_NAME, &key)
        .context("SSH鍵パスの取得失敗")?
        .ok_or_else(|| anyhow::anyhow!("認証情報が見つかりません"))
}

pub fn store_ssh_key_path(
    app: &tauri::AppHandle,
    server_id: &str,
    key_path: &str,
) -> Result<()> {
    let key = format!("{}:keypath", server_id);

    app.keyring()
        .set_password(SERVICE_NAME, &key, key_path)
        .context("SSH鍵パスの保存失敗")
}
```

### 3.3 セキュリティ考慮事項

#### ✅ 推奨事項
- 秘密鍵の**パス**のみ保存 (秘密鍵の内容は保存しない)
- サービス名は固定値 (`backup-tool-ssh`)
- ユーザー名にサーバーIDを含める (`xserver-01:keypath`)

#### ❌ 禁止事項
- 秘密鍵の内容をキーチェーンに保存
- パスフレーズをプレーンテキストで保存
- ログに認証情報を出力

---

## 4. tRPC統合の可能性

### 4.1 TauRPC: Tauri専用型安全IPC

#### 概要
- **目的**: Rust-TypeScript間の完全な型安全性
- **実装**: Specta + serde を使用してTypeScript型を自動生成
- **タイミング**: `pnpm tauri dev` 実行時に型を生成

#### アーキテクチャ

```
┌──────────────────────────────────────────┐
│  Rust Backend (src-tauri/src/main.rs)   │
│                                          │
│  #[derive(Specta, Serialize)]           │
│  pub struct BackupProgress {            │
│      file_count: u32,                   │
│      total_size: u64,                   │
│      current_file: String,              │
│  }                                       │
│                                          │
│  #[tauri::command]                      │
│  async fn start_backup(                 │
│      config: BackupConfig               │
│  ) -> Result<BackupProgress, String>    │
└──────────────────────────────────────────┘
              ↓ Specta generates types
┌──────────────────────────────────────────┐
│  TypeScript (src/bindings.ts) - 自動生成 │
│                                          │
│  export interface BackupProgress {      │
│    fileCount: number;                   │
│    totalSize: number;                   │
│    currentFile: string;                 │
│  }                                       │
│                                          │
│  export function startBackup(           │
│    config: BackupConfig                 │
│  ): Promise<BackupProgress>             │
└──────────────────────────────────────────┘
```

### 4.2 実装例

#### Cargo.toml
```toml
[dependencies]
tauri = { version = "2.0", features = ["specta"] }
taurpc = "0.5"
specta = "2.0"
serde = { version = "1.0", features = ["derive"] }
```

#### Rust側
```rust
// src-tauri/src/commands.rs
use specta::Type;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    server_id: String,
    remote_path: String,
    local_path: String,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    file_count: u32,
    total_size: u64,
    current_file: String,
    percent_complete: f32,
}

#[tauri::command]
#[specta::specta]
pub async fn start_backup(
    config: BackupConfig
) -> Result<BackupProgress, String> {
    // 実装...
    Ok(BackupProgress {
        file_count: 0,
        total_size: 0,
        current_file: String::new(),
        percent_complete: 0.0,
    })
}
```

#### TypeScript側 (自動生成)
```typescript
// src/bindings.ts - TauRPCが自動生成
export interface BackupConfig {
  serverId: string;
  remotePath: string;
  localPath: string;
}

export interface BackupProgress {
  fileCount: number;
  totalSize: number;
  currentFile: string;
  percentComplete: number;
}

export const invoke = {
  startBackup: (config: BackupConfig): Promise<BackupProgress> => {
    return window.__TAURI__.invoke('start_backup', { config });
  }
};
```

#### Reactコンポーネントでの使用
```typescript
// src/components/BackupButton.tsx
import { invoke } from '../bindings';
import type { BackupConfig } from '../bindings';

export function BackupButton() {
  const handleBackup = async () => {
    const config: BackupConfig = {
      serverId: 'xserver-01',
      remotePath: '/home/user/data',
      localPath: '/Users/me/backups'
    };

    try {
      const progress = await invoke.startBackup(config);
      console.log(`バックアップ進捗: ${progress.percentComplete}%`);
    } catch (error) {
      console.error('バックアップ失敗:', error);
    }
  };

  return <button onClick={handleBackup}>バックアップ開始</button>;
}
```

### 4.3 メリット・デメリット

#### ✅ メリット
- **型安全性**: コンパイル時に型エラーを検出
- **自動化**: 手動での型同期不要
- **リファクタリング耐性**: Rust側の変更がTypeScriptに自動反映
- **開発体験**: IDEで完全な自動補完

#### ⚠️ デメリット
- **学習コスト**: Specta + TauRPCの理解が必要
- **ビルド時間**: 型生成に追加時間
- **複雑性**: MVP段階では過剰設計の可能性

### 4.4 MVP推奨事項

**Phase 5-8 (MVP)**: 従来のTauri IPCを使用
**Phase 9-11**: TauRPCを導入し、既存コードを移行

理由:
- MVP段階ではシンプルさを優先
- コマンド数が少ない段階では手動型定義で十分
- Phase 9以降、機能拡張時に型安全性の恩恵が大きくなる

---

## 5. エラーハンドリング戦略

### 5.1 2025年のベストプラクティス

```rust
# Cargo.toml
[dependencies]
thiserror = "2.0"  # ライブラリ層エラー定義
anyhow = "2.0"     # アプリケーション層エラー伝播
```

### 5.2 階層別戦略

#### ライブラリ層: thiserror

```rust
// src-tauri/src/ssh/error.rs
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SshError {
    #[error("SSH接続失敗: {0}")]
    ConnectionFailed(String),

    #[error("認証失敗: ユーザー名またはキーが無効です")]
    AuthenticationFailed,

    #[error("ファイル転送失敗: {path}")]
    TransferFailed { path: String },

    #[error("タイムアウト: {seconds}秒経過")]
    Timeout { seconds: u64 },

    #[error("SSH2ライブラリエラー")]
    Ssh2Error(#[from] ssh2::Error),

    #[error("IO エラー")]
    IoError(#[from] std::io::Error),
}
```

#### アプリケーション層: anyhow

```rust
// src-tauri/src/commands/backup.rs
use anyhow::{Context, Result};
use crate::ssh::{SshClient, SshError};

#[tauri::command]
pub async fn start_backup(
    server_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    // anyhowでコンテキスト付きエラー処理
    let result = perform_backup(&server_id, &remote_path, &local_path)
        .context("バックアップ処理中にエラーが発生しました")
        .map_err(|e| format!("{:#}", e))?; // フロントエンドにString返却

    Ok(result)
}

fn perform_backup(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
) -> Result<String> {
    // 認証情報取得
    let key_path = get_ssh_key_path(server_id)
        .context(format!("サーバーID '{}' の認証情報が見つかりません", server_id))?;

    // SSH接続
    let client = SshClient::connect("example.com", 10022, "user", &key_path)
        .context("SSHサーバーへの接続に失敗しました")?;

    // ファイル転送
    let bytes = client.download_file(remote_path, local_path)
        .context(format!("ファイル '{}' のダウンロードに失敗しました", remote_path))?;

    Ok(format!("{}バイト転送完了", bytes))
}
```

### 5.3 フロントエンド側エラーハンドリング

```typescript
// src/utils/errorHandler.ts
export interface BackupError {
  type: 'connection' | 'authentication' | 'transfer' | 'timeout' | 'unknown';
  message: string;
  context?: string;
}

export function parseBackupError(error: string): BackupError {
  if (error.includes('SSH接続失敗')) {
    return {
      type: 'connection',
      message: 'サーバーに接続できませんでした',
      context: error,
    };
  }

  if (error.includes('認証失敗')) {
    return {
      type: 'authentication',
      message: 'SSH認証に失敗しました。設定を確認してください',
      context: error,
    };
  }

  if (error.includes('タイムアウト')) {
    return {
      type: 'timeout',
      message: '接続がタイムアウトしました',
      context: error,
    };
  }

  return {
    type: 'unknown',
    message: 'バックアップ中にエラーが発生しました',
    context: error,
  };
}
```

```tsx
// src/components/BackupButton.tsx
import { invoke } from '@tauri-apps/api/core';
import { parseBackupError } from '../utils/errorHandler';

export function BackupButton() {
  const [error, setError] = useState<BackupError | null>(null);

  const handleBackup = async () => {
    try {
      await invoke('start_backup', {
        serverId: 'xserver-01',
        remotePath: '/home/data',
        localPath: '/Users/me/backup',
      });
    } catch (e) {
      const backupError = parseBackupError(e as string);
      setError(backupError);

      // エラータイプ別のユーザー通知
      if (backupError.type === 'authentication') {
        showNotification('設定ページで認証情報を確認してください');
      }
    }
  };

  return (
    <>
      <button onClick={handleBackup}>バックアップ開始</button>
      {error && (
        <div className="error-message">
          {error.message}
          {error.context && <details>{error.context}</details>}
        </div>
      )}
    </>
  );
}
```

### 5.4 ログ戦略

```rust
// src-tauri/src/main.rs
use tracing::{info, warn, error};
use tracing_subscriber;

fn main() {
    // 本番環境ではINFO以上、開発環境ではDEBUG以上
    tracing_subscriber::fmt()
        .with_max_level(if cfg!(debug_assertions) {
            tracing::Level::DEBUG
        } else {
            tracing::Level::INFO
        })
        .init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![start_backup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```rust
// src-tauri/src/ssh/client.rs
use tracing::{info, warn, error, instrument};

impl SshClient {
    #[instrument(skip(private_key_path))] // 秘密鍵パスはログ出力しない
    pub fn connect(
        host: &str,
        port: u16,
        username: &str,
        private_key_path: &Path,
    ) -> Result<Self, SshError> {
        info!("SSH接続開始: {}:{} (user: {})", host, port, username);

        let tcp = TcpStream::connect_timeout(...)
            .map_err(|e| {
                error!("TCP接続失敗: {}", e);
                SshError::ConnectionFailed(e.to_string())
            })?;

        info!("SSH接続成功");
        Ok(Self { session })
    }
}
```

---

## 6. 推奨アーキテクチャ (最終提案)

### 6.1 ディレクトリ構造

```
src-tauri/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── commands/          # Tauriコマンド
│   │   ├── mod.rs
│   │   ├── backup.rs      # バックアップ実行
│   │   └── config.rs      # 設定管理
│   ├── ssh/               # SSH/SFTP クライアント
│   │   ├── mod.rs
│   │   ├── client.rs      # ssh2-rs ラッパー
│   │   ├── error.rs       # SshError 定義
│   │   └── retry.rs       # リトライロジック
│   ├── credentials/       # 認証情報管理
│   │   ├── mod.rs
│   │   └── keyring.rs     # tauri-plugin-keyring 統合
│   └── types.rs           # 共有型定義
└── capabilities/          # Tauri 2.x Capabilities
    ├── ssh-backup.toml
    └── file-access.toml

src/
├── main.tsx
├── App.tsx
├── components/
│   ├── BackupProgress.tsx
│   └── SettingsForm.tsx
├── utils/
│   ├── errorHandler.ts
│   └── credentialManager.ts
└── types/
    └── index.ts           # TypeScript型定義
```

### 6.2 依存関係

#### Cargo.toml
```toml
[dependencies]
tauri = { version = "2.0", features = ["protocol-asset"] }
tauri-plugin-keyring = "0.1"
ssh2 = "0.9"
anyhow = "2.0"
thiserror = "2.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

#### package.json
```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@tauri-apps/api": "^2.0.0",
    "tauri-plugin-keyring-api": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.0"
  }
}
```

### 6.3 実装フェーズ計画

#### Phase 5: SSH接続基盤
- [ ] ssh2-rsの統合
- [ ] リトライロジック実装
- [ ] エラーハンドリング (thiserror)

#### Phase 6: 認証情報管理
- [ ] tauri-plugin-keyringセットアップ
- [ ] 認証情報CRUD操作
- [ ] セキュリティテスト

#### Phase 7: バックアップコア機能
- [ ] SFTPファイル転送実装
- [ ] プログレストラッキング
- [ ] エラーリカバリー

#### Phase 8: フロントエンド統合
- [ ] Reactコンポーネント実装
- [ ] エラーハンドリングUI
- [ ] 設定画面

#### Phase 9-11 (オプション): 高度な機能
- [ ] TauRPC導入
- [ ] 自動型生成パイプライン
- [ ] E2Eテスト

### 6.4 セキュリティチェックリスト

#### 開発時
- [ ] `.env.local` をGitignore追加
- [ ] 開発用SSH鍵を生成 (`ssh-keygen -t ed25519`)
- [ ] テストサーバー (localhost:10022) セットアップ

#### 本番前
- [ ] 秘密鍵の内容をログ出力しないことを確認
- [ ] CSP設定を厳格化
- [ ] Capabilities を最小権限に設定
- [ ] キーチェーンアクセス権限のユーザー承認フロー確認

#### デプロイ後
- [ ] エックスサーバー接続テスト (実際のポート10022)
- [ ] macOS/Windows/Linuxでキーチェーン動作確認
- [ ] エラーログに機密情報が含まれないか監査

---

## 7. パフォーマンス最適化

### 7.1 SFTP転送最適化

```rust
// バッファサイズを最適化
const BUFFER_SIZE: usize = 32 * 1024; // 32KB

pub fn download_with_progress<F>(
    &self,
    remote_path: &str,
    local_path: &Path,
    mut on_progress: F,
) -> Result<u64>
where
    F: FnMut(u64, u64), // (transferred_bytes, total_bytes)
{
    let sftp = self.session.sftp()?;
    let mut remote_file = sftp.open(Path::new(remote_path))?;
    let mut local_file = std::fs::File::create(local_path)?;

    let total_size = remote_file.metadata()?.size;
    let mut transferred = 0u64;
    let mut buffer = vec![0u8; BUFFER_SIZE];

    loop {
        let n = remote_file.read(&mut buffer)?;
        if n == 0 { break; }

        local_file.write_all(&buffer[..n])?;
        transferred += n as u64;
        on_progress(transferred, total_size);
    }

    Ok(transferred)
}
```

### 7.2 並列ダウンロード (将来拡張)

```rust
// Phase 11: 複数ファイルを並列ダウンロード
use tokio::task;

pub async fn download_multiple(
    files: Vec<(String, PathBuf)>,
) -> Result<Vec<u64>> {
    let handles: Vec<_> = files
        .into_iter()
        .map(|(remote, local)| {
            task::spawn(async move {
                // 各ファイルを個別のSSHセッションでダウンロード
                download_single(remote, local).await
            })
        })
        .collect();

    let results = futures::future::join_all(handles).await;
    results.into_iter().collect()
}
```

---

## 8. テスト戦略

### 8.1 Rustユニットテスト

```rust
// src-tauri/src/ssh/client.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssh_connection_timeout() {
        let result = SshClient::connect(
            "192.0.2.1", // TEST-NET-1 (接続不可)
            10022,
            "test",
            Path::new("/tmp/test_key"),
        );

        assert!(matches!(result, Err(SshError::ConnectionFailed(_))));
    }

    #[test]
    fn test_invalid_key_path() {
        let result = SshClient::connect(
            "localhost",
            10022,
            "test",
            Path::new("/nonexistent/key"),
        );

        assert!(result.is_err());
    }
}
```

### 8.2 統合テスト (Dockerコンテナ使用)

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  test-ssh-server:
    image: linuxserver/openssh-server:latest
    ports:
      - "10022:2222"
    environment:
      - PUBLIC_KEY_FILE=/config/authorized_keys
    volumes:
      - ./test/ssh/authorized_keys:/config/authorized_keys
      - ./test/data:/data
```

```rust
#[tokio::test]
async fn test_full_backup_flow() {
    // Dockerコンテナ起動
    setup_test_server().await;

    let client = SshClient::connect(
        "localhost",
        10022,
        "testuser",
        Path::new("./test/ssh/test_key"),
    ).unwrap();

    let bytes = client.download_file(
        "/data/test.txt",
        Path::new("/tmp/downloaded.txt"),
    ).unwrap();

    assert!(bytes > 0);
    assert!(Path::new("/tmp/downloaded.txt").exists());
}
```

---

## 9. まとめと推奨事項

### 9.1 即座に実装すべき技術

| 技術 | 優先度 | 理由 |
|-----|-------|------|
| ssh2-rs | 🔴 必須 | エックスサーバー対応、安定性 |
| tauri-plugin-keyring | 🔴 必須 | セキュアな認証情報管理 |
| thiserror + anyhow | 🔴 必須 | 2025年標準のエラーハンドリング |
| Tauri 2.x CSP | 🔴 必須 | セキュリティ基盤 |

### 9.2 将来検討すべき技術

| 技術 | 検討タイミング | 理由 |
|-----|-------------|------|
| TauRPC | Phase 9 | 型安全性の恩恵が大きくなる段階 |
| russh | Phase 11 | 非同期処理が必要になった場合 |
| 並列ダウンロード | Phase 11 | パフォーマンス最適化フェーズ |

### 9.3 MVP成功のための重要ポイント

1. **シンプルさ優先**: Phase 5-8では過剰設計を避ける
2. **セキュリティファースト**: 認証情報の取り扱いに最大限の注意
3. **エラーハンドリング徹底**: ユーザーフレンドリーなエラーメッセージ
4. **段階的改善**: TauRPCは後から導入可能

### 9.4 次のアクションアイテム

1. ✅ ssh2-rs をCargo.tomlに追加
2. ✅ tauri-plugin-keyring をセットアップ
3. ✅ エラー型定義 (SshError) を作成
4. ⏳ テスト用Dockerコンテナ構築
5. ⏳ 基本的なSSH接続テスト実装

---

**文書バージョン**: 1.0
**最終更新**: 2026-01-10
**次回レビュー**: Phase 8完了時
