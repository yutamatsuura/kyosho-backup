# SSH/SFTP実装ガイド（要約版）

> 詳細版: [technical-research-ssh-sftp.md](./technical-research-ssh-sftp.md)

## クイックスタート

### 1. 依存関係追加

```toml
# src-tauri/Cargo.toml
[dependencies]
ssh2 = { version = "0.9", features = ["vendored-openssl"] }
ssh-key = { version = "0.6", features = ["std", "encryption"] }
tauri-plugin-keyring = "2.0"
backoff = { version = "0.4", features = ["tokio"] }
thiserror = "1.0"
anyhow = "1.0"
log = "0.4"
```

### 2. 最小実装コード

```rust
// src-tauri/src/lib.rs

use ssh2::Session;
use std::net::TcpStream;
use std::path::Path;

#[tauri::command]
fn connect_xserver(
    server_number: String,
    server_id: String,
    key_path: String,
) -> Result<String, String> {
    // TCP接続
    let host = format!("{}.xserver.jp:10022", server_number);
    let tcp = TcpStream::connect(&host)
        .map_err(|e| format!("接続失敗: {}", e))?;

    // SSHセッション
    let mut sess = Session::new().unwrap();
    sess.set_tcp_stream(tcp);
    sess.set_timeout(30_000);
    sess.handshake()
        .map_err(|e| format!("SSH接続失敗: {}", e))?;

    // 公開鍵認証
    sess.userauth_pubkey_file(&server_id, None, Path::new(&key_path), None)
        .map_err(|e| format!("認証失敗: {}", e))?;

    // SFTP開始
    let sftp = sess.sftp()
        .map_err(|e| format!("SFTP失敗: {}", e))?;

    Ok("接続成功".to_string())
}
```

### 3. フロントエンド呼び出し

```typescript
// src/App.tsx
import { invoke } from '@tauri-apps/api/core';

async function connectToServer() {
  try {
    const result = await invoke<string>('connect_xserver', {
      serverNumber: 'sv12345',
      serverId: 'xs987654',
      keyPath: '/Users/user/.ssh/id_rsa',
    });
    console.log(result);
  } catch (error) {
    console.error('接続エラー:', error);
  }
}
```

## 重要ポイント

### エックスサーバー固有設定

```yaml
ホスト: sv12345.xserver.jp (サーバー番号)
ポート: 10022 (固定)
ユーザー: xs987654 (サーバーID)
認証: 公開鍵のみ
```

### セキュリティ必須対応

1. パスフレーズはOS Keychainに保存
2. 秘密鍵パーミッション 0600 確認
3. ログにパスフレーズ出力禁止
4. タイムアウト設定必須

### エラーハンドリング

```rust
// リトライ対象エラー
- NetworkTimeout
- ConnectionRefused
- HostUnreachable

// 即座に失敗させるエラー
- AuthenticationFailed
- PublicKeyNotFound
- InvalidKeyFormat
```

## 次のステップ

1. [詳細技術調査](./technical-research-ssh-sftp.md)を読む
2. [サンプルコード](#2-最小実装コード)を実装
3. リトライ機構を追加（backoffクレート）
4. キーチェーン統合（tauri-plugin-keyring）

## トラブルシューティング

### よくあるエラー

**"Authentication failed"**
- ユーザー名がサーバーID（xs〜）であることを確認
- 秘密鍵パスが正しいか確認

**"Connection refused"**
- ポート番号が 10022 であることを確認
- ホスト名が sv〜.xserver.jp 形式であることを確認

**"Permission denied (publickey)"**
- 秘密鍵ファイルのパーミッションを確認（chmod 600）
- エックスサーバー側で公開鍵が登録されているか確認

---

**参照**: [technical-research-ssh-sftp.md](./technical-research-ssh-sftp.md)
