# SSH/SFTP バックアップ技術調査レポート

**調査日**: 2026-01-09
**対象プロジェクト**: サーバーバックアップ自動化ツール
**技術スタック**: Rust + Tauri 2.x

---

## 目次
1. [Rust SSH/SFTPクレート比較](#1-rust-sshsftpクレート比較)
2. [OpenSSH形式秘密鍵の取り扱い](#2-openssh形式秘密鍵の取り扱い)
3. [エックスサーバーSSH接続](#3-エックスサーバーssh接続)
4. [OS標準キーチェーン統合](#4-os標準キーチェーン統合)
5. [エラーハンドリング・リトライ機構](#5-エラーハンドリングリトライ機構)
6. [セキュリティベストプラクティス](#6-セキュリティベストプラクティス)
7. [推奨実装アーキテクチャ](#7-推奨実装アーキテクチャ)

---

## 1. Rust SSH/SFTPクレート比較

### 1.1 主要クレート一覧

| クレート名 | 最新版 | 同期/非同期 | 特徴 | 推奨度 |
|-----------|--------|------------|------|--------|
| **ssh2-rs** | 0.9.x | 同期 | libssh2バインディング、安定性高 | ⭐⭐⭐⭐⭐ |
| **russh** | 0.54.x | 非同期 | Pure Rust、Tokio統合 | ⭐⭐⭐⭐ |
| **async-ssh2-tokio** | 0.10.x | 非同期 | russhの高レベルラッパー | ⭐⭐⭐ |
| **remotefs-ssh** | - | 同期/非同期 | ファイルシステム抽象化 | ⭐⭐ |

### 1.2 ssh2-rs (推奨)

**選定理由**:
- ✅ 成熟した安定性（libssh2ベース）
- ✅ SFTPプロトコル完全サポート
- ✅ 本番実績が豊富
- ✅ Tauriとの統合が容易（同期API）
- ✅ ドキュメントが充実

**基本的な使用例**:
```rust
use ssh2::Session;
use std::net::TcpStream;

// 接続確立
let tcp = TcpStream::connect("sv12345.xserver.jp:10022")?;
let mut sess = Session::new()?;
sess.set_tcp_stream(tcp);
sess.handshake()?;

// 公開鍵認証
sess.userauth_pubkey_file(
    "xs987654",
    None, // 公開鍵パス（Noneで自動検出）
    Path::new("/Users/user/.ssh/id_rsa"),
    None  // パスフレーズ（必要に応じて）
)?;

// SFTPセッション開始
let sftp = sess.sftp()?;

// ファイルダウンロード
let remote_path = Path::new("/home/xs987654/backup/database.sql");
let mut remote_file = sftp.open(remote_path)?;
let mut contents = Vec::new();
remote_file.read_to_end(&mut contents)?;
```

**タイムアウト設定**:
```rust
// ミリ秒単位でタイムアウト設定（デフォルトは無制限）
sess.set_timeout(30_000); // 30秒

// キープアライブ設定（秒単位）
sess.set_keepalive(true, 60); // 60秒ごとにキープアライブパケット送信
```

### 1.3 russh (代替案)

**利点**:
- Pure Rust実装（C依存なし）
- Tokio統合で高性能非同期処理
- 最新のRustイディオムに準拠

**欠点**:
- ssh2-rsより新しく実績が少ない
- Tauri同期コマンドとの統合に追加作業が必要
- ドキュメントがやや不足

**使用例**:
```rust
use russh::*;
use russh_sftp::client::SftpSession;

async fn connect() -> Result<SftpSession, Box<dyn std::error::Error>> {
    let config = client::Config::default();
    let mut session = client::connect(config, ("sv12345.xserver.jp", 10022)).await?;

    // 公開鍵認証
    let key = russh_keys::load_secret_key("/Users/user/.ssh/id_rsa", None)?;
    session.authenticate_publickey("xs987654", Arc::new(key)).await?;

    // SFTPセッション開始
    let channel = session.channel_open_session().await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;

    Ok(sftp)
}
```

### 1.4 最終推奨: **ssh2-rs**

**決定理由**:
1. **安定性**: 10年以上の本番実績
2. **シンプル性**: Tauriコマンドで同期処理が容易
3. **エコシステム**: ssh-keyクレートと連携可能
4. **メンテナンス**: 積極的に開発継続中
5. **トラブルシューティング**: Stack Overflowに豊富な情報

---

## 2. OpenSSH形式秘密鍵の取り扱い

### 2.1 OpenSSH鍵フォーマット

**新形式** (OpenSSH 7.8以降):
```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn
...
-----END OPENSSH PRIVATE KEY-----
```

**旧形式** (PEM):
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234...
-----END RSA PRIVATE KEY-----
```

### 2.2 ssh-keyクレートによるパース

**推奨クレート**: `ssh-key = "0.6"`

```rust
use ssh_key::PrivateKey;
use std::path::Path;

// OpenSSH形式秘密鍵の読み込み
fn load_openssh_key(path: &Path, passphrase: Option<&str>) -> Result<PrivateKey, ssh_key::Error> {
    let key_data = std::fs::read_to_string(path)?;

    match passphrase {
        Some(pass) => PrivateKey::from_openssh(key_data)?.decrypt(pass),
        None => PrivateKey::from_openssh(key_data),
    }
}

// 自動判別（OpenSSH/PEM両対応）
fn load_private_key_auto(path: &Path) -> Result<PrivateKey, ssh_key::Error> {
    let key_data = std::fs::read_to_string(path)?;

    if key_data.contains("BEGIN OPENSSH PRIVATE KEY") {
        PrivateKey::from_openssh(key_data)
    } else if key_data.contains("BEGIN RSA PRIVATE KEY") {
        PrivateKey::from_openssh(key_data) // ssh-keyは両形式対応
    } else {
        Err(ssh_key::Error::FormatEncoding)
    }
}
```

### 2.3 ssh2-rsとの統合

**重要**: ssh2-rsは直接ファイルパスを受け取るため、通常はパース不要

```rust
use ssh2::Session;

// ファイルパスで直接認証（推奨）
sess.userauth_pubkey_file(
    "xs987654",
    None, // 公開鍵（Noneで自動検出）
    Path::new("/Users/user/.ssh/id_rsa"), // 秘密鍵
    Some("passphrase123") // パスフレーズ
)?;
```

**パースが必要なケース**:
- メモリ上の鍵データを使用する場合
- カスタム暗号化解除が必要な場合

```rust
use ssh_key::PrivateKey;
use ssh2::Session;

// メモリ上の鍵データで認証
let key_str = std::fs::read_to_string("/Users/user/.ssh/id_rsa")?;
let private_key = PrivateKey::from_openssh(&key_str)?;

// ssh2::Sessionに渡す（ssh2は内部でlibssh2を使用）
// 注: ssh2-rsは直接メモリ鍵をサポートしないため、
// 一時ファイル経由またはuserauth_pubkey_memoryを使用
```

### 2.4 対応鍵タイプ

| 鍵タイプ | ssh-key対応 | ssh2-rs対応 | 推奨度 |
|---------|-----------|------------|--------|
| **Ed25519** | ✅ | ✅ | ⭐⭐⭐⭐⭐ (最高) |
| **RSA 2048/4096** | ✅ | ✅ | ⭐⭐⭐⭐ |
| **ECDSA P-256/384/521** | ✅ | ✅ | ⭐⭐⭐ |
| **DSA** | ✅ | ✅ | ❌ (非推奨) |

**エックスサーバー向け推奨**: **Ed25519** または **RSA 4096bit**

---

## 3. エックスサーバーSSH接続

### 3.1 接続パラメータ

```yaml
ホスト名: sv12345.xserver.jp (サーバー番号)
ポート: 10022 (固定、デフォルト22ではない)
ユーザー名: xs987654 (サーバーID、svではない)
認証方式: 公開鍵認証のみ（パスワード認証不可）
鍵形式: OpenSSH形式（推奨）またはPEM形式
```

### 3.2 よくあるミス

❌ **間違い**:
```rust
// サーバー番号をユーザー名に使用
sess.userauth_pubkey_file("sv12345", ...)?; // NG

// デフォルトポート22を使用
TcpStream::connect("sv12345.xserver.jp:22")?; // NG

// パスワード認証を試行
sess.userauth_password("xs987654", "password")?; // NG（サポートされていない）
```

✅ **正しい実装**:
```rust
use ssh2::Session;
use std::net::TcpStream;
use std::path::Path;

fn connect_xserver(
    server_number: &str, // "sv12345"
    server_id: &str,     // "xs987654"
    key_path: &Path,
    passphrase: Option<&str>,
) -> Result<Session, Box<dyn std::error::Error>> {
    // 1. TCP接続（ポート10022固定）
    let host = format!("{}.xserver.jp:10022", server_number);
    let tcp = TcpStream::connect(&host)?;

    // 2. SSH接続確立
    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(30_000); // 30秒タイムアウト
    sess.handshake()?;

    // 3. 公開鍵認証（サーバーIDを使用）
    sess.userauth_pubkey_file(
        server_id,
        None, // 公開鍵は自動検出
        key_path,
        passphrase,
    )?;

    // 4. 認証確認
    if !sess.authenticated() {
        return Err("認証失敗".into());
    }

    Ok(sess)
}
```

### 3.3 SSH設定ファイル（~/.ssh/config）

開発者向けに推奨設定:

```ssh-config
Host xserver
    HostName sv12345.xserver.jp
    Port 10022
    User xs987654
    IdentityFile ~/.ssh/xserver_backup_key
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ConnectTimeout 30
```

プログラムでの利用:
```rust
// ssh2-config クレートで設定ファイルパース
use ssh2_config::{SshConfig, ParseRule};

let config_path = dirs::home_dir()
    .unwrap()
    .join(".ssh/config");

let config = SshConfig::parse_file(&config_path, ParseRule::STRICT)?;
let params = config.query("xserver");

// パラメータ取得
let hostname = params.host_name.unwrap(); // "sv12345.xserver.jp"
let port = params.port.unwrap_or(22);     // 10022
let user = params.user.unwrap();          // "xs987654"
let identity_file = params.identity_file.first().unwrap();
```

### 3.4 接続テストコマンド

```bash
# ターミナルでテスト
ssh -i ~/.ssh/xserver_backup_key sv12345.xserver.jp -p 10022 -l xs987654

# 成功時の出力例
Welcome to XSERVER sv12345.xserver.jp
```

---

## 4. OS標準キーチェーン統合

### 4.1 tauri-plugin-keyring

**推奨クレート**: `tauri-plugin-keyring`（HuakunShen製）

```toml
[dependencies]
tauri-plugin-keyring = "2.0"
```

### 4.2 プラットフォーム別バックエンド

| OS | バックエンド | 技術仕様 |
|----|------------|---------|
| **macOS** | Keychain Services | Security.framework API |
| **Windows** | Credential Manager | Windows Credential Vault |
| **Linux** | Secret Service | GNOME Keyring / KWallet |

### 4.3 実装例

**Rust側（Tauriコマンド）**:
```rust
use tauri::Manager;

#[tauri::command]
fn save_ssh_passphrase(
    app: tauri::AppHandle,
    server_id: String,
    passphrase: String,
) -> Result<(), String> {
    let service = format!("backup-tool.ssh.{}", server_id);

    app.keyring()
        .set_password(&service, &server_id, &passphrase)
        .map_err(|e| format!("キーチェーン保存失敗: {}", e))
}

#[tauri::command]
fn get_ssh_passphrase(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<String, String> {
    let service = format!("backup-tool.ssh.{}", server_id);

    app.keyring()
        .get_password(&service, &server_id)
        .map_err(|e| format!("キーチェーン取得失敗: {}", e))
}

#[tauri::command]
fn delete_ssh_passphrase(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    let service = format!("backup-tool.ssh.{}", server_id);

    app.keyring()
        .delete_password(&service, &server_id)
        .map_err(|e| format!("キーチェーン削除失敗: {}", e))
}
```

**フロントエンド側（React/TypeScript）**:
```typescript
import { invoke } from '@tauri-apps/api/core';

// パスフレーズ保存
async function savePassphrase(serverId: string, passphrase: string): Promise<void> {
  await invoke('save_ssh_passphrase', {
    serverId,
    passphrase,
  });
}

// パスフレーズ取得
async function getPassphrase(serverId: string): Promise<string> {
  return await invoke<string>('get_ssh_passphrase', {
    serverId,
  });
}

// パスフレーズ削除
async function deletePassphrase(serverId: string): Promise<void> {
  await invoke('delete_ssh_passphrase', {
    serverId,
  });
}
```

### 4.4 セキュリティ設定

**Service名の命名規則**:
```rust
// 推奨フォーマット: {アプリ名}.{カテゴリ}.{識別子}
let service = format!("backup-tool.ssh.{}", server_id);
```

**アクセス権限**:
- macOS: ユーザー認証後アクセス可（Touch ID対応可能）
- Windows: ログインユーザーのみアクセス可
- Linux: Secret ServiceのDBus経由で暗号化保存

**注意事項**:
⚠️ キーチェーンはパスフレーズのみ保存、秘密鍵ファイル本体は保存しない
⚠️ 秘密鍵パスは設定ファイル（TOML）に平文保存（パス自体は機密情報ではない）

### 4.5 代替案: Tauri Stronghold

**強力な暗号化が必要な場合**:
```toml
[dependencies]
tauri-plugin-stronghold = "2.0"
```

**特徴**:
- ✅ メモリ暗号化（RAM内でも暗号化状態を維持）
- ✅ 自動ロック機構
- ❌ マスターパスワードが必要（UX低下）
- ❌ キーチェーンより複雑

**推奨用途**: パスフレーズのみならtauri-plugin-keyring、秘密鍵ファイル全体を保存する場合はStronghold

---

## 5. エラーハンドリング・リトライ機構

### 5.1 SSH接続エラー分類

```rust
use ssh2::Error as Ssh2Error;

#[derive(Debug)]
enum SshConnectionError {
    // 一時的エラー（リトライ可能）
    NetworkTimeout,
    ConnectionRefused,
    HostUnreachable,

    // 認証エラー（リトライ不可）
    AuthenticationFailed,
    PublicKeyNotFound,
    InvalidPassphrase,

    // 設定エラー（リトライ不可）
    InvalidHostname,
    InvalidPort,
    InvalidKeyFormat,

    // その他
    Unknown(String),
}

impl From<Ssh2Error> for SshConnectionError {
    fn from(err: Ssh2Error) -> Self {
        match err.code() {
            ssh2::ErrorCode::Session(-18) => SshConnectionError::NetworkTimeout,
            ssh2::ErrorCode::Session(-15) => SshConnectionError::PublicKeyNotFound,
            ssh2::ErrorCode::Session(-19) => SshConnectionError::AuthenticationFailed,
            _ => SshConnectionError::Unknown(err.to_string()),
        }
    }
}

impl SshConnectionError {
    fn is_retryable(&self) -> bool {
        matches!(
            self,
            SshConnectionError::NetworkTimeout
                | SshConnectionError::ConnectionRefused
                | SshConnectionError::HostUnreachable
        )
    }
}
```

### 5.2 Exponential Backoffリトライ

**推奨クレート**: `backoff = "0.4"`

```rust
use backoff::{retry, ExponentialBackoff, Error};
use ssh2::Session;
use std::net::TcpStream;
use std::time::Duration;

fn connect_with_retry(
    host: &str,
    port: u16,
    user: &str,
    key_path: &Path,
) -> Result<Session, Box<dyn std::error::Error>> {
    // Exponential Backoff設定
    let backoff_config = ExponentialBackoff {
        initial_interval: Duration::from_secs(1),  // 初回リトライ: 1秒後
        max_interval: Duration::from_secs(60),     // 最大待機: 60秒
        max_elapsed_time: Some(Duration::from_secs(300)), // 全体で5分まで
        multiplier: 2.0,                           // 指数: 1秒 → 2秒 → 4秒 → ...
        randomization_factor: 0.1,                 // ジッター: ±10%
        ..ExponentialBackoff::default()
    };

    // リトライ可能な接続操作
    let operation = || {
        // TCP接続
        let tcp = TcpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::TimedOut {
                    Error::transient(e) // リトライ対象
                } else {
                    Error::permanent(e) // 即座に失敗
                }
            })?;

        // SSH Handshake
        let mut sess = Session::new().unwrap();
        sess.set_tcp_stream(tcp);
        sess.set_timeout(30_000);
        sess.handshake().map_err(|e| Error::transient(e))?;

        // 認証
        sess.userauth_pubkey_file(user, None, key_path, None)
            .map_err(|e| Error::permanent(e))?; // 認証失敗は永続エラー

        Ok(sess)
    };

    retry(backoff_config, operation)
        .map_err(|e| e.into())
}
```

### 5.3 リトライログ実装

```rust
use log::{info, warn, error};

fn connect_with_logging(
    host: &str,
    attempt: u32,
    max_attempts: u32,
) -> Result<Session, SshConnectionError> {
    info!("SSH接続試行 {}/{}: {}", attempt, max_attempts, host);

    match try_connect(host) {
        Ok(sess) => {
            info!("SSH接続成功: {}", host);
            Ok(sess)
        }
        Err(e) if e.is_retryable() && attempt < max_attempts => {
            let wait_time = 2u64.pow(attempt - 1); // 1秒, 2秒, 4秒, ...
            warn!(
                "SSH接続失敗（リトライ可能）: {} - {}秒後に再試行 ({}/{})",
                e, wait_time, attempt, max_attempts
            );
            std::thread::sleep(Duration::from_secs(wait_time));
            connect_with_logging(host, attempt + 1, max_attempts)
        }
        Err(e) => {
            error!("SSH接続失敗（永続エラー）: {}", e);
            Err(e)
        }
    }
}
```

### 5.4 SFTP転送エラーハンドリング

```rust
use ssh2::Sftp;
use std::io::{Read, Write};
use std::path::Path;

fn download_file_with_retry(
    sftp: &Sftp,
    remote_path: &Path,
    local_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let operation = || {
        // リモートファイルオープン
        let mut remote_file = sftp
            .open(remote_path)
            .map_err(|e| Error::transient(e))?;

        // ローカルファイル作成
        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| Error::permanent(e))?;

        // チャンク単位で転送（ネットワーク中断に対応）
        let mut buffer = [0u8; 8192]; // 8KB バッファ
        loop {
            match remote_file.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    local_file.write_all(&buffer[..n])
                        .map_err(|e| Error::permanent(e))?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {
                    continue; // リトライ
                }
                Err(e) => return Err(Error::transient(e)),
            }
        }

        Ok(())
    };

    retry(ExponentialBackoff::default(), operation)
        .map_err(|e| e.into())
}
```

### 5.5 タイムアウト戦略

```rust
// 操作別タイムアウト設定
const CONNECT_TIMEOUT: u32 = 30_000;  // 接続: 30秒
const AUTH_TIMEOUT: u32 = 15_000;     // 認証: 15秒
const TRANSFER_TIMEOUT: u32 = 300_000; // 転送: 5分

fn configure_timeouts(sess: &mut Session) {
    sess.set_timeout(CONNECT_TIMEOUT);
    sess.set_keepalive(true, 60); // 60秒ごとキープアライブ
}
```

---

## 6. セキュリティベストプラクティス

### 6.1 認証情報の保存ルール

**絶対に保存してはいけない情報**:
- ❌ パスワード（平文）
- ❌ 秘密鍵ファイル本体（バイナリ）
- ❌ パスフレーズ（平文）

**保存して良い情報**:
- ✅ 秘密鍵ファイルパス（文字列）
- ✅ サーバーホスト名
- ✅ ユーザー名
- ✅ ポート番号

**保存場所別ガイドライン**:

| データ種類 | 保存場所 | 暗号化 | 例 |
|-----------|---------|-------|---|
| **設定情報** | TOML | 不要 | `key_path = "/Users/user/.ssh/id_rsa"` |
| **パスフレーズ** | OS Keychain | 自動 | tauri-plugin-keyring使用 |
| **秘密鍵本体** | ~/.ssh/ | 任意 | `ssh-keygen -t ed25519` |

### 6.2 秘密鍵ファイルのパーミッション

```rust
use std::fs;
use std::os::unix::fs::PermissionsExt;

fn validate_key_permissions(key_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let metadata = fs::metadata(key_path)
            .map_err(|e| format!("鍵ファイル読み取り失敗: {}", e))?;

        let perms = metadata.permissions();
        let mode = perms.mode() & 0o777;

        // 秘密鍵は0600 (rw-------) が必須
        if mode != 0o600 {
            return Err(format!(
                "危険な鍵ファイルパーミッション: {:o}\n推奨: chmod 600 {}",
                mode,
                key_path.display()
            ));
        }
    }

    Ok(())
}

// 自動修正（ユーザー確認推奨）
fn fix_key_permissions(key_path: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(key_path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(key_path, perms)?;
    }
    Ok(())
}
```

### 6.3 ログ出力のセキュリティ

**危険な実装例** ❌:
```rust
// NG: パスフレーズをログ出力
log::debug!("認証試行: user={}, passphrase={}", user, passphrase);

// NG: 秘密鍵内容を出力
log::error!("鍵読み込み失敗: {:?}", key_content);
```

**安全な実装例** ✅:
```rust
// OK: 機密情報をマスク
log::debug!("認証試行: user={}, key_path={}", user, key_path.display());
log::info!("認証成功: user={}", user);

// OK: エラー情報のみ出力
log::error!("鍵読み込み失敗: {}", err);
```

**セキュアログ構造体**:
```rust
use std::fmt;

#[derive(Debug)]
struct SecureCredential {
    username: String,
    #[allow(dead_code)]
    passphrase: String, // メモリには保持するがログ出力しない
}

impl fmt::Display for SecureCredential {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Credential(user={})", self.username)
        // パスフレーズは出力しない
    }
}
```

### 6.4 SSH Host Key検証

**本番環境では必須**:
```rust
use ssh2::KnownHosts;

fn verify_host_key(
    sess: &Session,
    hostname: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // 既知ホストファイル読み込み
    let known_hosts_path = dirs::home_dir()
        .unwrap()
        .join(".ssh/known_hosts");

    let mut known_hosts = sess.known_hosts()?;
    known_hosts.read_file(&known_hosts_path, ssh2::KnownHostFileKind::OpenSSH)?;

    // サーバーのホストキー取得
    let (hostkey, _hostkey_type) = sess.host_key().unwrap();

    // 検証
    match known_hosts.check(hostname, hostkey) {
        ssh2::CheckResult::Match => {
            log::info!("ホストキー検証成功: {}", hostname);
            Ok(())
        }
        ssh2::CheckResult::NotFound => {
            // 初回接続時: ユーザーに確認を求める
            log::warn!("未知のホストキー: {}", hostname);
            Err("ホストキー未検証".into())
        }
        ssh2::CheckResult::Mismatch => {
            // MITM攻撃の可能性
            log::error!("ホストキー不一致（MITM攻撃の可能性）: {}", hostname);
            Err("ホストキー検証失敗".into())
        }
        _ => Err("ホストキー検証エラー".into()),
    }
}
```

### 6.5 セキュアな一時ファイル処理

```rust
use tempfile::NamedTempFile;
use std::io::Write;

fn secure_temp_file_download(
    sftp: &Sftp,
    remote_path: &Path,
    final_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // 一時ファイル作成（自動削除）
    let mut temp_file = NamedTempFile::new()?;

    // SFTP転送
    let mut remote_file = sftp.open(remote_path)?;
    std::io::copy(&mut remote_file, &mut temp_file)?;

    // チェックサム検証（オプション）
    temp_file.flush()?;
    let checksum = calculate_checksum(temp_file.path())?;
    verify_checksum(&checksum, remote_path)?;

    // 最終位置に移動（アトミック操作）
    temp_file.persist(final_path)?;

    Ok(())
}
```

### 6.6 暗号化通信の強制

```rust
// ssh2-rsはデフォルトで暗号化されているが、
// プロトコルバージョン確認は推奨

fn enforce_ssh_protocol(sess: &Session) -> Result<(), String> {
    let banner = sess.banner().unwrap_or("");

    // SSH 2.0以上を要求
    if !banner.starts_with("SSH-2.0") {
        return Err(format!("古いSSHプロトコル検出: {}", banner));
    }

    Ok(())
}
```

---

## 7. 推奨実装アーキテクチャ

### 7.1 モジュール構成

```
src-tauri/
├── src/
│   ├── main.rs
│   ├── ssh/
│   │   ├── mod.rs           # SSHモジュール公開API
│   │   ├── client.rs        # SSH接続クライアント
│   │   ├── config.rs        # SSH設定管理
│   │   ├── error.rs         # エラー型定義
│   │   └── retry.rs         # リトライ機構
│   ├── sftp/
│   │   ├── mod.rs           # SFTPモジュール公開API
│   │   ├── transfer.rs      # ファイル転送ロジック
│   │   └── progress.rs      # 進捗通知
│   ├── keychain/
│   │   ├── mod.rs           # キーチェーン操作
│   │   └── passphrase.rs    # パスフレーズ管理
│   ├── backup/
│   │   ├── mod.rs           # バックアップエントリポイント
│   │   ├── executor.rs      # バックアップ実行
│   │   └── verification.rs  # 整合性検証
│   └── commands.rs          # Tauriコマンド定義
```

### 7.2 依存関係（Cargo.toml）

```toml
[package]
name = "backup-tool"
version = "0.1.0"
edition = "2021"

[dependencies]
# Tauri
tauri = { version = "2.0", features = ["shell-open"] }
tauri-plugin-keyring = "2.0"

# SSH/SFTP
ssh2 = { version = "0.9", features = ["vendored-openssl"] }
ssh-key = { version = "0.6", features = ["std", "encryption"] }

# エラーハンドリング
thiserror = "1.0"
anyhow = "1.0"
backoff = { version = "0.4", features = ["tokio"] }

# 非同期（Tauri内部でTokio使用）
tokio = { version = "1", features = ["full"] }

# ログ
log = "0.4"
env_logger = "0.11"

# ユーティリティ
dirs = "5.0"
serde = { version = "1.0", features = ["derive"] }
toml = "0.8"
tempfile = "3.8"

# セキュリティ
sha2 = "0.10" # チェックサム検証用

[target.'cfg(unix)'.dependencies]
nix = "0.27" # Unixパーミッション操作
```

### 7.3 サンプル実装（統合版）

```rust
// src-tauri/src/ssh/client.rs

use ssh2::Session;
use std::net::TcpStream;
use std::path::Path;
use backoff::{retry, ExponentialBackoff, Error};
use log::{info, warn, error};

pub struct SshClient {
    session: Session,
}

impl SshClient {
    /// エックスサーバーへ接続（リトライ付き）
    pub fn connect_xserver(
        server_number: &str,
        server_id: &str,
        key_path: &Path,
        passphrase: Option<&str>,
    ) -> Result<Self, anyhow::Error> {
        let host = format!("{}.xserver.jp", server_number);
        let port = 10022u16;

        info!("エックスサーバー接続開始: {}@{}:{}", server_id, host, port);

        // Exponential Backoff設定
        let backoff_config = ExponentialBackoff {
            initial_interval: std::time::Duration::from_secs(1),
            max_interval: std::time::Duration::from_secs(60),
            max_elapsed_time: Some(std::time::Duration::from_secs(300)),
            multiplier: 2.0,
            randomization_factor: 0.1,
            ..ExponentialBackoff::default()
        };

        // リトライ可能な接続操作
        let operation = || {
            Self::try_connect(&host, port, server_id, key_path, passphrase)
                .map_err(|e| {
                    warn!("SSH接続試行失敗: {} - リトライします", e);
                    Error::transient(e)
                })
        };

        let session = retry(backoff_config, operation)?;
        info!("SSH接続成功: {}@{}", server_id, host);

        Ok(Self { session })
    }

    /// 実際の接続処理（内部用）
    fn try_connect(
        host: &str,
        port: u16,
        user: &str,
        key_path: &Path,
        passphrase: Option<&str>,
    ) -> Result<Session, anyhow::Error> {
        // 1. TCP接続
        let tcp = TcpStream::connect(format!("{}:{}", host, port))?;

        // 2. SSHセッション確立
        let mut sess = Session::new()?;
        sess.set_tcp_stream(tcp);
        sess.set_timeout(30_000); // 30秒
        sess.set_keepalive(true, 60); // 60秒間隔
        sess.handshake()?;

        // 3. 公開鍵認証
        sess.userauth_pubkey_file(user, None, key_path, passphrase)?;

        // 4. 認証確認
        if !sess.authenticated() {
            anyhow::bail!("SSH認証失敗");
        }

        Ok(sess)
    }

    /// SFTPセッション取得
    pub fn sftp(&self) -> Result<ssh2::Sftp, ssh2::Error> {
        self.session.sftp()
    }
}
```

```rust
// src-tauri/src/commands.rs

use tauri::{command, Manager, AppHandle};
use std::path::PathBuf;
use crate::ssh::SshClient;
use crate::keychain;

#[command]
pub async fn start_backup(
    app: AppHandle,
    server_number: String,
    server_id: String,
    key_path: PathBuf,
) -> Result<String, String> {
    // キーチェーンからパスフレーズ取得
    let passphrase = keychain::get_passphrase(&app, &server_id).ok();

    // SSH接続
    let client = SshClient::connect_xserver(
        &server_number,
        &server_id,
        &key_path,
        passphrase.as_deref(),
    )
    .map_err(|e| format!("SSH接続失敗: {}", e))?;

    // SFTPセッション取得
    let sftp = client.sftp()
        .map_err(|e| format!("SFTP開始失敗: {}", e))?;

    // バックアップ実行
    crate::backup::execute(&sftp)
        .map_err(|e| format!("バックアップ失敗: {}", e))?;

    Ok("バックアップ完了".to_string())
}
```

### 7.4 フロントエンド統合（React）

```typescript
// src/hooks/useBackup.ts

import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

interface BackupConfig {
  serverNumber: string;
  serverId: string;
  keyPath: string;
}

export function useBackup() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const startBackup = async (config: BackupConfig) => {
    setIsRunning(true);
    setError(null);

    try {
      const result = await invoke<string>('start_backup', {
        serverNumber: config.serverNumber,
        serverId: config.serverId,
        keyPath: config.keyPath,
      });

      console.log('バックアップ成功:', result);
      return result;
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsRunning(false);
    }
  };

  return {
    isRunning,
    progress,
    error,
    startBackup,
  };
}
```

---

## 8. まとめと推奨事項

### 8.1 技術選定サマリー

| 項目 | 推奨技術 | 理由 |
|-----|---------|------|
| **SSH/SFTPライブラリ** | ssh2-rs 0.9.x | 安定性・実績・Tauri統合 |
| **鍵パーサー** | ssh-key 0.6.x | OpenSSH形式完全対応 |
| **認証情報保存** | tauri-plugin-keyring | OS統合・セキュア |
| **リトライ機構** | backoff 0.4.x | Exponential Backoff実装 |
| **エラーハンドリング** | thiserror + anyhow | Rustエコシステム標準 |

### 8.2 実装優先順位

**Phase 1（MVP必須）**:
1. ✅ ssh2-rsによる基本SSH接続
2. ✅ SFTP単一ファイルダウンロード
3. ✅ 秘密鍵パス設定（TOML保存）
4. ✅ シンプルなエラーメッセージ表示

**Phase 2（品質向上）**:
5. ⏳ Exponential Backoffリトライ
6. ⏳ tauri-plugin-keyringでパスフレーズ保存
7. ⏳ 進捗通知（Tauriイベント）
8. ⏳ 詳細ログ出力

**Phase 3（高度機能）**:
9. ⏳ ホストキー検証
10. ⏳ チェックサム検証
11. ⏳ 並列ダウンロード（複数ファイル）

### 8.3 セキュリティチェックリスト

- [ ] 秘密鍵ファイルパーミッション 0600 検証
- [ ] パスフレーズをログ出力していないか確認
- [ ] OS Keychainにのみ認証情報保存
- [ ] SSH 2.0プロトコル強制
- [ ] タイムアウト設定（無限待機防止）
- [ ] HTTPS通信のみ許可（外部API使用時）

### 8.4 参考リソース

**公式ドキュメント**:
- [ssh2-rs API Documentation](https://docs.rs/ssh2)
- [ssh-key Documentation](https://docs.rs/ssh-key)
- [tauri-plugin-keyring](https://github.com/HuakunShen/tauri-plugin-keyring)
- [Tauri v2 公式ガイド](https://v2.tauri.app)

**エックスサーバー**:
- [SSH設定マニュアル](https://www.xserver.ne.jp/manual/man_server_ssh.php)

**セキュリティ**:
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)

---

**調査担当**: Claude (Sonnet 4.5)
**最終更新**: 2026-01-09
**レビュー**: 未実施
