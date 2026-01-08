サーバーバックアップ自動化ツール - 要件定義書

要件定義の作成原則
- **「あったらいいな」は絶対に作らない**
- **拡張可能性のための余分な要素は一切追加しない**
- **将来の「もしかして」のための準備は禁止**
- **今、ここで必要な最小限の要素のみ**

## 1. プロジェクト概要

### 1.1 成果目標
サーバー内の任意フォルダを指定してボタン1つで完全バックアップ。手動・自動実行対応、Mac/Windows両対応の汎用バックアップツール

### 1.2 成功指標

#### 定量的指標
- フォルダ指定からバックアップ完了まで**3クリック以内**で操作完了
- **技術知識ゼロの人でも5分以内**でツール設定完了
- **Mac/Windows両環境で100%動作**する互換性
- **複数サイト・複数フォルダに対応**し、フォルダ切り替えが簡単

#### 定性的指標
- **「フォルダを選んでクリックするだけ」**の直感的操作性
- **どのPC・どのサイトでも同じ手順**で使える一貫性
- **手動でも自動でも確実に動作**する信頼性
- **エラーが起きても何が問題かすぐ分かる**明確性

## 2. システム全体像

### 2.1 主要機能一覧
- **バックアップ実行機能**: エックスサーバーの任意フォルダをSFTP経由でローカルPCにバックアップ
- **設定管理機能**: SSH接続設定、保存先フォルダ設定の管理
- **進捗監視機能**: リアルタイム転送状況の表示とエラーハンドリング

### 2.2 ユーザーロールと権限（MVPのため認証不要）
- **単一ユーザー**: 全機能にアクセス可能（ローカルデスクトップアプリのため）

### 2.3 認証・認可要件
- **認証方式**: SSH公開鍵認証（エックスサーバー側で設定）
- **セキュリティレベル**: 認証情報はOS標準キーチェーンで暗号化保存
- **管理機能**: 不要（単一ユーザー向けツールのため）

## 3. ページ詳細仕様

### 3.1 P-001: メインページ（バックアップ実行）

#### 目的
フォルダ指定してワンクリックでバックアップを実行

#### 主要機能
- サーバー接続状況表示
- フォルダ選択（ドロップダウンまたは入力）
- バックアップ実行ボタン
- リアルタイム進捗表示（ファイル数、転送速度、残り時間）
- 結果表示（成功/失敗、保存先フォルダリンク）

#### 必要な操作
| 操作種別 | 操作内容 | 必要な入力 | 期待される出力 |
|---------|---------|-----------|---------------|
| 取得 | サーバーフォルダ一覧取得 | SSH接続情報 | フォルダ一覧（bouon-boushin.net等） |
| 取得 | 接続状況確認 | SSH接続設定 | 接続成功/失敗ステータス |
| 作成 | バックアップ実行 | 選択フォルダパス、保存先 | 転送進捗とファイル一覧 |
| 取得 | 転送進捗監視 | 実行中のジョブID | 進捗率、転送速度、残り時間 |

#### 処理フロー
1. アプリ起動時にサーバー接続テスト実行
2. 接続成功時にフォルダ一覧を取得・表示
3. ユーザーがフォルダ選択＋バックアップボタンクリック
4. SFTP接続確立、ファイル転送開始
5. リアルタイム進捗表示（ファイル数、転送量、速度）
6. 完了時に結果表示＋保存先フォルダを開く

#### データ構造（概念）
```yaml
BackupJob:
  識別子: UUID（実行ごとに生成）
  基本情報:
    - sourceFolder（必須）: サーバー側フォルダパス
    - destinationFolder（必須）: ローカル保存先
    - startTime（必須）: 開始日時
    - endTime（任意）: 完了日時
  進捗情報:
    - totalFiles: 総ファイル数
    - completedFiles: 完了ファイル数
    - totalBytes: 総転送サイズ
    - transferredBytes: 転送済みサイズ
    - transferSpeed: 現在の転送速度
  関連:
    - SSHConnection（1対1関係）
```

### 3.2 P-002: 設定ページ

#### 目的
SSH接続設定と保存先設定を管理

#### 主要機能
- SSH接続設定（サーバー、ユーザー名、秘密鍵ファイル選択）
- 保存先フォルダ設定
- 接続テスト機能
- 設定の保存・読み込み

#### 必要な操作
| 操作種別 | 操作内容 | 必要な入力 | 期待される出力 |
|---------|---------|-----------|---------------|
| 作成 | SSH設定保存 | サーバー情報、秘密鍵パス | 設定保存成功通知 |
| 更新 | SSH設定更新 | 変更する設定項目 | 更新成功通知 |
| 取得 | 設定読み込み | なし | 保存済み設定情報 |
| 作成 | 接続テスト実行 | SSH接続設定 | 接続成功/失敗結果 |

#### 処理フロー
1. 設定ページ表示時に保存済み設定を読み込み
2. ユーザーが設定項目を入力・変更
3. 「接続テスト」ボタンで実際の接続を確認
4. テスト成功後に「保存」ボタンでOS キーチェーンに暗号化保存
5. メインページに戻る

#### データ構造（概念）
```yaml
SSHConnection:
  識別子: 設定名（ユーザー定義）
  基本情報:
    - hostname（必須）: sv****.xserver.jp
    - port（必須）: 10022
    - username（必須）: サーバーID
    - privateKeyPath（必須）: 秘密鍵ファイルパス
  メタ情報:
    - created: 作成日時
    - lastTested: 最終接続テスト日時
  関連:
    - BackupJob（1対多関係）
```

## 4. データ設計概要

### 4.1 主要エンティティ

```yaml
SSHConnection:
  概要: サーバーへの接続設定を管理
  主要属性:
    - 接続情報（hostname, port, username, privateKeyPath）
    - メタ情報（作成日時、最終テスト日時）
  関連:
    - BackupJob（1対多関係：1つの接続設定で複数のバックアップジョブ）

BackupJob:
  概要: バックアップ実行の履歴と進捗を管理
  主要属性:
    - 実行情報（フォルダパス、保存先、実行時間）
    - 進捗情報（ファイル数、転送量、速度）
  関連:
    - SSHConnection（多対1関係：複数のジョブが1つの接続設定を使用）
```

### 4.2 エンティティ関係図
```
SSHConnection ─────── BackupJob
      │                   │
      1                   多
   （1つの接続設定）    （複数の実行履歴）
```

### 4.3 バリデーションルール
```yaml
hostname:
  - ルール: FQDN形式（例：sv1234.xserver.jp）
  - 理由: エックスサーバー接続の正確性確保

port:
  - ルール: 10022固定
  - 理由: エックスサーバーのSSHポート仕様

privateKeyPath:
  - ルール: 実在するファイルパス、読み取り権限あり
  - 理由: SSH認証の成功確保

sourceFolder:
  - ルール: 絶対パス形式（/で開始）
  - 理由: サーバー側パス指定の明確化
```

## 5. 制約事項

### 外部API制限
- **エックスサーバー**: SSH接続は公開鍵認証のみ（パスワード認証不可）
- **SFTP転送**: デフォルト1GB/ファイル、最大2GB/ファイル

### 技術的制約
- **Tauri**: Windows 7以降、macOS 10.15以降が必要
- **認証情報**: OS標準キーチェーンに依存（外部ストレージ不可）

## 5.1 セキュリティ要件

### 基本方針
本プロジェクトは **CVSS 3.1（Common Vulnerability Scoring System）** に準拠したセキュリティ要件を満たすこと。

CVSS 3.1の評価観点:
- **機密性（Confidentiality）**: 不正アクセス防止、データ暗号化
- **完全性（Integrity）**: データ改ざん防止、入力検証
- **可用性（Availability）**: DoS対策、冗長化

詳細な診断と改善は、Phase 11（本番運用診断）で @本番運用診断オーケストレーター が実施します。

---

### プロジェクト固有の必須要件

**認証機能がある場合（必須）**:
- ✅ SSH公開鍵認証の強制（パスワード認証禁止）
- ✅ 秘密鍵ファイルの権限確認（600/400のみ許可）
- ✅ 認証情報のOS標準キーチェーン保存

**ファイル転送機能（必須）**:
- ✅ ファイルパス検証（ディレクトリトラバーサル対策）
- ✅ 転送先フォルダの書き込み権限確認
- ✅ エラーメッセージでのパス情報漏洩防止

**その他の一般要件**:
- ✅ 入力値のサニタイゼーション
- ✅ ログファイルでの機密情報除外
- ✅ アプリ更新時の署名検証

---

### 運用要件：可用性とエラーハンドリング

**接続エラー対応（全プロジェクト必須）**:
- 接続タイムアウト: 30秒以内で判定
- リトライ機能: 3回まで自動再試行
- エラー分類: ネットワークエラー/認証エラー/権限エラーの明確な分離

**転送中断対応（全プロジェクト必須）**:
- 進行中転送のキャンセル機能
- 部分転送ファイルのクリーンアップ
- 転送再開機能（将来拡張で対応）

## 6. 技術スタック

### フロントエンド
- **フレームワーク**: React 18
- **言語**: TypeScript 5
- **UIライブラリ**: Tailwind CSS
- **状態管理**: Zustand
- **ルーティング**: React Router v6
- **ビルドツール**: Vite 5

### バックエンド（Tauri Core）
- **言語**: Rust
- **SFTP**: ssh2 crate（libssh2ベース）
- **認証管理**: keyring crate（OS標準キーチェーン）
- **ファイル操作**: tokio（非同期I/O）
- **設定管理**: serde + toml

### データストレージ
- **設定ファイル**: TOML形式（ローカル保存）
- **認証情報**: OS標準キーチェーン
  - macOS: Keychain Services
  - Windows: Credential Manager

### 配布・インフラ
- **配布方法**: GitHub Releases（無料）
- **自動更新**: Tauri公式プラグイン
- **署名**: 無署名配布（初回のみ信頼設定）

## 8. 必要な外部サービス・アカウント

### 必須サービス
| サービス名 | 用途 | 取得先 | 備考 |
|-----------|------|--------|------|
| エックスサーバーSSH設定 | SFTP接続認証 | サーバーパネル | 既存契約で追加費用なし |

### オプションサービス
| サービス名 | 用途 | 取得先 | 備考 |
|-----------|------|--------|------|
| GitHub | ソースコード管理・配布 | https://github.com | 無料プラン利用 |

## 9. 今後の拡張予定

**原則**: 拡張予定があっても、必要最小限の実装のみを行う

- 「あったらいいな」は実装しない
- 拡張可能性のための余分な要素は追加しない
- 将来の「もしかして」のための準備は禁止
- 今、ここで必要な最小限の要素のみを実装

拡張が必要になった時点で、Phase 11: 機能拡張オーケストレーターを使用して追加実装を行います。

（拡張候補があれば以下に記載、ただし実装はしない）
- 自動スケジュール機能（cron風の定期実行）
- 複数サーバー管理（プロファイル切り替え）
- バックアップ履歴とログ表示
- 差分バックアップ機能（rsync活用）
- 圧縮オプション（zip/tar.gz対応）

### 1.1 Tauri (Rust + Web Frontend) ⭐️ **最推奨**

#### メリット
- **軽量**: バイナリサイズ 3-10MB (Electron: 100MB+)
- **メモリ効率**: 起動時メモリ使用量 28-40MB (Electron: 150-300MB)
- **高速起動**: 0.4秒 (Electron: 1.5秒)
- **セキュリティ**: Rustによる堅牢なバックエンド、厳格な権限システム
- **クロスプラットフォーム**: macOS, Windows, Linux (2.0からiOS/Androidも対応)
- **自動アップデート**: 公式プラグインで署名付き更新に対応
- **認証情報管理**: Rustの`keyring`クレートでOS標準のキーチェーン対応
- **採用率**: 2024年のTauri 2.0リリース以降、年間35%成長

#### デメリット
- Rustの基本知識が必要(ただし最小限でOK)
- Electronより新しいため事例は少ない(急速に増加中)

#### 技術スタック
```
Frontend: HTML/CSS/JavaScript (React, Vue, Svelte等)
Backend: Rust
SFTP: ssh2 クレート (libssh2ベース)
認証管理: keyring クレート (OS keychain統合)
配布: .app (macOS), .exe/.msi (Windows)
```

### 1.2 Electron (Node.js + Chromium)

#### メリット
- **成熟したエコシステム**: VS Code, Slack, Discord等の実績
- **豊富なライブラリ**: Node.jsの全パッケージが利用可能
- **開発者数**: JavaScriptのみで開発可能
- **ドキュメント**: 10年以上の実績と豊富な事例

#### デメリット
- **大容量**: バイナリサイズ 100MB+
- **メモリ消費**: 起動時 250MB+
- **起動遅延**: 1.5秒程度
- **セキュリティ**: 攻撃面が広い

#### 技術スタック
```
Frontend: HTML/CSS/JavaScript
Backend: Node.js
SFTP: ssh2 (Node.js)
認証管理: keytar / electron-store
配布: electron-builder
```

### 1.3 Python + PyQt6

#### メリット
- **学習曲線**: Pythonの簡潔さ
- **豊富なライブラリ**: paramiko (SFTP), keyring (認証管理)
- **プロフェッショナルUI**: 高品質なウィジェット

#### デメリット
- **配布の複雑さ**: PyInstallerで50-100MB
- **ライセンス**: GPL or 商用ライセンス必須
- **起動遅延**: Pythonインタプリタの初期化
- **依存関係**: Python環境の管理が必要

#### 技術スタック
```
GUI: PyQt6
SFTP: paramiko
認証管理: keyring
配布: PyInstaller
```

### 1.4 Go + Wails

#### メリット
- **小型バイナリ**: 4MB程度
- **高性能**: ネイティブコンパイル
- **シンプルな配布**: 単一実行ファイル
- **Web開発経験活用**: フロントエンドはHTML/CSS/JS

#### デメリット
- **依存関係の問題**: セットアップ時にトラブルが多い
- **エコシステム**: TauriやElectronより小規模
- **学習曲線**: Go言語の習得が必要

#### 技術スタック
```
Frontend: HTML/CSS/JavaScript
Backend: Go
SFTP: golang.org/x/crypto/ssh
認証管理: OS固有のAPIラッパー実装が必要
```

### 1.5 ブラウザベース (HTML/JS)

#### メリット
- **配布不要**: ブラウザで動作
- **クロスプラットフォーム**: 完全な互換性

#### デメリット
- **ファイルアクセス制限**: ローカルファイルシステムへの直接アクセス不可
- **SFTP不可**: ブラウザからSSH/SFTP接続は不可能
- **バックグラウンド実行**: 不可能
- **認証情報管理**: ブラウザストレージは不十分

**結論**: バックアップツールには不適合 ❌

---

## 1.6 ブラウザ版SFTP接続の技術的詳細調査（2026-01-08）

### 調査背景
前のエージェントが「HTMLでスクリプト生成→ダウンロード→実行」方式を提案していたため、その実現可能性と技術的制約を詳細調査した。

### 調査結果: ブラウザからの直接SSH/SFTP接続

#### 技術的制約（2026年現在）

1. **直接接続は不可能**
   - ブラウザセキュリティモデル上、TCP/SSH直接接続は禁止
   - Same-Origin Policy、CORS制約により回避不可
   - JavaScript単体でのSSH/SFTPプロトコル実装は動作しない

2. **WebSocket/WebAssemblyプロキシ方式（技術的に可能だが非推奨）**

   **実装方法**:
   - WebAssemblyでSSHクライアント（C/C++ライブラリ）をコンパイル
   - WebSocketでサーバー側プロキシを経由してTCP接続を確立
   - ブラウザ ↔ WebSocketサーバー ↔ SSHサーバー の3層構造

   **実装例**:
   - `ssheasy`: Golang + Wasm SSH/SFTPクライアント
   - `sftp-ws`: WebSocket上でSFTP v3を実装

   **致命的な問題点**:
   - **サーバー側プロキシが必須** → 「ブラウザのみで完結」という前提が崩壊
   - プロキシサーバーの構築・運用コストが発生
   - セキュリティリスク: 中間プロキシがSSH通信を仲介（MITM攻撃の懸念）
   - ホスト鍵検証の省略が多く、セキュリティが弱体化
   - WebSocket自体のセキュリティ脆弱性（Cross-Site WebSocket Hijacking等）

3. **File System Access API（PWA）の限界**

   **現状（2026年）**:
   - Chromiumベースブラウザのみ対応（Safari/Firefox未対応）
   - ローカルファイルの読み書きは可能
   - **しかしSSH/SFTP接続機能は提供しない**
   - あくまでローカルファイルシステムのアクセスAPIのみ

### 「スクリプト生成→ダウンロード→実行」方式の評価

#### 技術的実現可能性: ✅ **可能**

**実装方法**:
```html
<!-- HTMLで設定フォームを表示 -->
<form>
  <input id="host" placeholder="ホスト名">
  <input id="user" placeholder="ユーザー名">
  <input id="port" placeholder="ポート番号">
  <input id="localPath" placeholder="バックアップ元パス">
  <input id="remotePath" placeholder="バックアップ先パス">
  <button onclick="generateScript()">スクリプト生成</button>
</form>

<script>
function generateScript() {
  const config = {
    host: document.getElementById('host').value,
    user: document.getElementById('user').value,
    port: document.getElementById('port').value,
    localPath: document.getElementById('localPath').value,
    remotePath: document.getElementById('remotePath').value
  };

  // Bashスクリプト生成
  const script = `#!/bin/bash
rsync -avz --bwlimit=10240 -e 'ssh -p ${config.port}' \\
  ${config.localPath} ${config.user}@${config.host}:${config.remotePath}
`;

  // Pythonスクリプト生成
  const pythonScript = `import paramiko
import os

host = "${config.host}"
port = ${config.port}
username = "${config.user}"
local_path = "${config.localPath}"
remote_path = "${config.remotePath}"

# SFTP接続実装...
`;

  // ダウンロードトリガー
  const blob = new Blob([script], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'backup.sh';
  a.click();
}
</script>
```

**Windows向け（WinSCPスクリプト生成）**:
```javascript
function generateWinSCPScript(config) {
  const script = `option batch abort
option confirm off
open sftp://${config.user}@${config.host}:${config.port}/ -privatekey="${config.keyPath}"
put "${config.localPath}" "${config.remotePath}"
exit`;

  const batchFile = `@echo off
"C:\\Program Files (x86)\\WinSCP\\WinSCP.com" /script=backup-script.txt
`;

  // 2つのファイルをZIPで提供
  return { script, batchFile };
}
```

#### ユーザー体験の評価

**想定フロー**:
1. ブラウザでHTMLツールを開く
2. 設定（ホスト名、ユーザー名、パス等）を入力
3. 「スクリプト生成」ボタンをクリック
4. `backup.sh`（macOS/Linux）または`backup.bat`（Windows）がダウンロードされる
5. ユーザーが手動でダウンロードフォルダから実行

**問題点**:
- ❌ **ワンクリックバックアップは実現不可**
  - 最低でも「生成→ダウンロード→実行」の3ステップ
  - ブラウザのダウンロードダイアログが割り込む
  - 実行時に権限確認（macOS Gatekeeper、Windows SmartScreen）

- ❌ **スケジュール実行が複雑**
  - ユーザー自身でcron/タスクスケジューラーに登録が必要
  - 非技術者には困難

- ❌ **進捗表示不可**
  - スクリプト実行中の進捗をブラウザに返せない
  - ターミナル/コマンドプロンプトでの確認のみ

- ❌ **エラーハンドリング不可**
  - スクリプト実行失敗時、ブラウザに通知できない
  - ログファイルの手動確認が必要

- ❌ **認証情報管理の課題**
  - SSH鍵パスをスクリプトにハードコード
  - または毎回手動で入力（自動化の意味がない）

#### セキュリティ評価

**リスク要因**:
1. **平文での秘密情報埋め込み**
   - 生成されたスクリプトにホスト名、ユーザー名、パスが記載
   - ダウンロードフォルダに残る（削除忘れリスク）

2. **未署名スクリプトの実行**
   - macOS: Gatekeeper警告
   - Windows: SmartScreen警告
   - ユーザーが「とにかく実行」を選択する習慣化リスク

3. **スクリプトの改ざんリスク**
   - ダウンロード後、実行前に第三者が改ざん可能

**ベストプラクティス（2026年）との乖離**:
- 自動化スクリプトは署名すべき → 未署名
- 認証情報はOS標準キーチェーン保存すべき → 平文またはファイルパス
- エラーログ、監視、異常検知が必須 → 実装不可

#### 実用性の結論

**技術的には可能だが、実用的ではない ⚠️**

**理由**:
1. **UXが劣悪**
   - 「設定→生成→ダウンロード→実行」の多段階フロー
   - 毎回ダウンロードフォルダから探して実行が必要
   - スケジュール設定は別途手動作業

2. **自動化の本質を満たさない**
   - 「自動バックアップツール」なのに手動実行が必須
   - 技術者でないユーザーには使いこなせない

3. **セキュリティリスク**
   - 平文での認証情報管理
   - 未署名スクリプト実行の習慣化

4. **保守性の欠如**
   - 設定変更のたびに再生成→再ダウンロード→再配置が必要
   - バージョン管理不可

### 代替案の提案

#### 「Webベースの設定UI + ネイティブアプリでの実行」ハイブリッド方式

**アーキテクチャ**:
```
[Web UI (設定のみ)]
    ↓ (JSON設定をエクスポート)
[ローカルの軽量CLIツール]
    ↓
[実際のバックアップ実行]
```

**実装例**:
1. **Web UI**: https://backup-config.example.com
   - 設定を視覚的に入力
   - `config.json`をダウンロード

2. **CLIツール**: `backup-cli`（Go/Rust製、5MB以下）
   - GitHub Releasesから1回だけダウンロード
   - `backup-cli run config.json`で実行
   - cron/タスクスケジューラーに登録

**メリット**:
- ✅ Web UIで直感的な設定
- ✅ ネイティブアプリで確実な実行
- ✅ 進捗表示、エラーハンドリング可能
- ✅ OS標準キーチェーン統合
- ✅ 自動更新対応

### 最終推奨

**「ブラウザ版」の開発は推奨しない ❌**

**理由まとめ**:
1. 直接SSH/SFTP接続は技術的に不可能
2. スクリプト生成方式は技術的に可能だが実用性が低い
3. UX、セキュリティ、保守性の全てで劣る
4. 「自動化」の本質（ユーザーが何もしなくても動く）を満たせない

**代わりに採用すべき方式**:
- **Tauri製ネイティブアプリ**（requirements.mdの1.1参照）
  - バイナリサイズ5MB以下（ブラウザ版+スクリプトと同等）
  - インストール1回のみ、以降は完全自動化
  - ワンクリックバックアップ、スケジュール実行、進捗表示、全て実現可能
  - セキュア（OS標準キーチェーン、署名付き配布）

**どうしてもブラウザ版が必要な場合**:
- 「設定ジェネレーター」として位置づける
- 実際のバックアップは別途CLIツールを配布
- または「Tauriアプリのダウンロードページ」として機能させる

---

## 2. ファイル転送ライブラリ

### 2.1 パフォーマンス比較 (2025-2026年ベンチマーク)

#### 重要な発見
- **クライアント実装が重要**: 同じプロトコルでもライブラリにより4倍の性能差
- **SFTP vs FTPS**: SFTPが一貫してアップロード・ダウンロードで優位
- **バッファサイズ最適化**:
  - Windows: `-B 100000` (100KB)
  - Linux: `-B 262000` (262KB)
  - デフォルト: 32KB

#### 推奨ライブラリ

**Tauri/Rust**
```rust
ssh2 = "0.9"  // libssh2ベース、リクエストキューイング対応
```
- 非同期処理対応
- 進捗コールバック実装可能
- プロダクション実績多数

**Electron/Node.js**
```javascript
ssh2 = "^1.15.0"
```
- ストリーミング転送対応
- 進捗イベント発行

**Python**
```python
paramiko >= 3.4.0
```
- 成熟したライブラリ
- 詳細な進捗取得可能

### 2.2 大容量ファイル転送最適化

#### 必須機能
1. **チャンク分割転送**: 1GB以上のファイルは分割
2. **並列転送**: 複数ファイルの同時転送
3. **リトライ機構**: ネットワーク切断時の自動再試行
4. **レジューム機能**: 中断箇所からの再開
5. **リクエストキューイング**: サーバー待機時間削減

#### 進捗表示実装
```rust
// Tauri例
use ssh2::Session;

// 転送コールバック
fn transfer_progress(current: u64, total: u64) {
    let percent = (current as f64 / total as f64 * 100.0) as u8;
    emit_to_frontend("transfer_progress", percent);
}
```

---

## 3. 設定管理とセキュリティ

### 3.1 認証情報の安全な保存

#### OS標準キーチェーン統合 ⭐️ **最推奨**

**macOS**: Keychain Services
**Windows**: Credential Manager
**Linux**: Secret Service API / libsecret

#### 実装方法

**Tauri/Rust**
```toml
[dependencies]
keyring = "2.3"
```

```rust
use keyring::Entry;

// 保存
let entry = Entry::new("backup-tool", "sftp-password")?;
entry.set_password("secret123")?;

// 取得
let password = entry.get_password()?;
```

**Python**
```python
import keyring

# 保存
keyring.set_password("backup-tool", "sftp-password", "secret123")

# 取得
password = keyring.get_password("backup-tool", "sftp-password")
```

### 3.2 設定ファイル構造

```json
{
  "version": "1.0.0",
  "profiles": [
    {
      "id": "uuid-v4",
      "name": "メインサーバー",
      "host": "backup.example.com",
      "port": 22,
      "username": "user",
      "authMethod": "keychain",  // keychain | sshKey | password
      "remotePath": "/backups/macbook",
      "schedule": {
        "enabled": true,
        "frequency": "daily",
        "time": "02:00"
      },
      "localPaths": [
        "/Users/username/Documents",
        "/Users/username/Pictures"
      ]
    }
  ]
}
```

**保存場所**
- macOS: `~/Library/Application Support/BackupTool/config.json`
- Windows: `%APPDATA%/BackupTool/config.json`

### 3.3 セキュリティベストプラクティス

1. **暗号化**: 設定ファイル自体は平文OK(パスはOS標準キーチェーン)
2. **権限制限**: 設定ファイルは `chmod 600` (所有者のみ読み書き)
3. **検証**: サーバー証明書の検証必須
4. **ログ**: パスワードやキーをログに出力しない

---

## 4. 配布とインストール

### 4.1 macOS配布

#### 必須手順 (2026年現在)
1. **コード署名**: Apple Developer ID必須
2. **公証 (Notarization)**: macOS Sequoia 15以降で厳格化
3. **配布形式**: DMG推奨 (ZIPは常に検疫対象)

#### 実装手順
```bash
# 1. アプリケーション署名
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: YourName" \
  BackupTool.app

# 2. DMG作成
hdiutil create -volname "Backup Tool" -srcfolder BackupTool.app \
  -ov -format UDZO BackupTool.dmg

# 3. 公証申請
xcrun notarytool submit BackupTool.dmg \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "TEAMID"

# 4. チケットのステープル
xcrun stapler staple BackupTool.dmg
```

#### 配布方法
- **GitHub Releases**: 無料、自動更新と統合しやすい ⭐️
- **Homebrew Cask**: コマンドでインストール可能
- **直接ダウンロード**: 自社サイトから配布

### 4.2 Windows配布

#### 配布形式
- **MSI**: 企業向け、GPO対応
- **EXE**: 個人向け、シンプル ⭐️
- **Chocolatey**: パッケージマネージャー

#### 署名
- **コード署名証明書**: 推奨(年間$100-300程度)
- 未署名の場合: Windows Defenderの警告表示

#### 実装 (Tauri)
```toml
[package.metadata.bundle]
identifier = "com.example.backuptool"
icon = ["icons/icon.ico"]
resources = []

[package.metadata.bundle.windows]
wix_language = "ja-JP"
```

### 4.3 自動アップデート機能

#### Tauri実装 ⭐️

**Cargo.toml**
```toml
[dependencies]
tauri-plugin-updater = "2.0"
```

**src-tauri/tauri.conf.json**
```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/username/backup-tool/releases/latest/download/latest.json"
      ],
      "pubkey": "YOUR_PUBLIC_KEY"
    }
  }
}
```

**セキュリティ**
- 署名必須(無効化不可)
- 公開鍵で検証
- HTTPS必須

#### Electron実装

```javascript
const { autoUpdater } = require('electron-updater');

autoUpdater.checkForUpdatesAndNotify();
```

### 4.4 GitHub Releases統合

**latest.json** (自動生成)
```json
{
  "version": "1.2.0",
  "notes": "バグ修正とパフォーマンス改善",
  "pub_date": "2026-01-08T12:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://github.com/.../BackupTool_1.2.0_x64.dmg"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/.../BackupTool_1.2.0_aarch64.dmg"
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/.../BackupTool_1.2.0_x64.msi"
    }
  }
}
```

---

## 5. 総合推奨

### 🏆 最推奨: Tauri

#### 理由
1. **最小リソース**: バイナリ5MB以下、メモリ40MB以下
2. **高速**: 起動0.4秒、ファイル転送も高効率
3. **セキュア**: Rustの安全性 + OS標準キーチェーン統合
4. **モダン**: 2024-2026年の最新トレンド、年間35%成長
5. **配布簡単**: 単一バイナリ、公式自動更新プラグイン
6. **将来性**: モバイル対応(iOS/Android)も可能
7. **ユーザー体験**: ネイティブ並みの軽快さ

#### 開発難易度
- **フロントエンド**: HTML/CSS/JavaScript (React/Vue等) → 既存知識活用
- **バックエンド**: Rust基礎のみ → 公式テンプレートで大部分カバー
- **学習曲線**: 1-2週間でプロトタイプ可能

### 実装技術スタック

```
Framework: Tauri 2.x
Frontend: React + TypeScript
Backend: Rust
SFTP: ssh2 crate
認証: keyring crate
UI: shadcn/ui (Tailwind CSS)
配布: GitHub Releases + 自動更新
```

### 最小構成での実装ステップ

1. **セットアップ** (1日)
   - Tauri CLI インストール
   - プロジェクト作成
   - 開発環境構築

2. **UI実装** (3-5日)
   - 設定画面
   - ファイル選択
   - 進捗表示

3. **バックエンド** (5-7日)
   - SFTP接続
   - ファイル転送ロジック
   - 進捗コールバック

4. **認証管理** (2-3日)
   - keyring統合
   - 設定の永続化

5. **スケジュール** (2-3日)
   - cron式スケジューラー
   - バックグラウンド実行

6. **配布準備** (2-3日)
   - 署名設定
   - DMG/MSI作成
   - GitHub Actions CI/CD

**合計**: 2-3週間でMVP完成

---

## 6. セキュリティチェックリスト

- [ ] 認証情報はOS標準キーチェーンのみ保存
- [ ] SSHホスト鍵の検証実装
- [ ] HTTPS通信のみ(自動更新)
- [ ] ログにパスワード/鍵を出力しない
- [ ] 設定ファイルのパーミッション制限
- [ ] コード署名と公証(macOS)
- [ ] 自動更新の署名検証
- [ ] エラーメッセージから機密情報除外

---

## 7. 次のステップ

1. **Tauri開発環境構築**
   ```bash
   # Rust インストール
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

   # Tauri CLI
   cargo install tauri-cli

   # プロジェクト作成
   cargo create-tauri-app
   ```

2. **プロトタイプ作成**
   - 基本的なSFTP接続テスト
   - 単一ファイル転送
   - 進捗表示

3. **フィードバック収集**
   - 実際の使用環境でテスト
   - パフォーマンス測定
   - UI/UX改善

---

## 参考リンク

- [Tauri公式](https://v2.tauri.app/)
- [keyring crate](https://docs.rs/keyring/latest/keyring/)
- [ssh2 crate](https://docs.rs/ssh2/latest/ssh2/)
- [macOS Notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Tauri Updater Plugin](https://v2.tauri.app/plugin/updater/)
