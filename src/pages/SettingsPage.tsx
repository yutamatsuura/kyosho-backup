import React, { useState, useEffect } from 'react';
import SettingsForm from '../components/SettingsForm';
import { useAuth } from '../hooks/useAuth';
import PinAuthModal from '../components/PinAuthModal';
import {
  loadSettings,
  saveSettings,
  testSshConnection,
  selectFile,
  selectFolder,
  formatErrorMessage
} from '../utils/tauriApi';
import { SettingsFormData, AppSettings, BackupConfig } from '../types/tauri';
import { Settings, Shield, Lock, Unlock, Search, RefreshCw, Wifi, Save, Home, Info } from 'lucide-react';

const SettingsPage: React.FC = () => {
  const { isPinEnabled, disablePin, checkPinStatus } = useAuth();
  const [formData, setFormData] = useState<SettingsFormData>({
    hostname: '',
    port: 10022,
    username: '',
    keyPath: '',
    remoteFolder: '',
    localFolder: '',
  });

  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string>('');

  // PIN認証関連の状態
  const [showPinSetup, setShowPinSetup] = useState<boolean>(false);
  const [showPinDisable, setShowPinDisable] = useState<boolean>(false);
  const [pinMessage, setPinMessage] = useState<string>('');

  // 設定を読み込み
  useEffect(() => {
    const loadAppSettings = async () => {
      try {
        const settings = await loadSettings();

        if (settings.backup_configs.length > 0) {
          const config = settings.backup_configs[0];
          setFormData({
            hostname: config.ssh.hostname,
            port: config.ssh.port,
            username: config.ssh.username,
            keyPath: config.ssh.key_path,
            remoteFolder: config.remote_folder,
            localFolder: settings.default_local_backup_path || '',
          });
        } else if (settings.default_local_backup_path) {
          setFormData(prev => ({
            ...prev,
            localFolder: settings.default_local_backup_path || '',
          }));
        }
      } catch (error) {
        console.error('設定の読み込みに失敗:', error);
      }
    };

    loadAppSettings();
  }, []);

  const handleInputChange = (field: keyof SettingsFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setTestResult(''); // 設定変更時にテスト結果をクリア
  };

  const handleKeyFileSelection = async () => {
    try {
      const filePath = await selectFile();
      if (filePath) {
        setFormData(prev => ({ ...prev, keyPath: filePath }));
        setTestResult('');
      }
    } catch (error) {
      alert('ファイル選択エラー: ' + formatErrorMessage(error));
    }
  };

  const handleLocalFolderSelection = async () => {
    try {
      const folderPath = await selectFolder();
      if (folderPath) {
        setFormData(prev => ({ ...prev, localFolder: folderPath }));
      }
    } catch (error) {
      alert('フォルダ選択エラー: ' + formatErrorMessage(error));
    }
  };

  const handleConnectionTest = async () => {
    // 必須フィールドのチェック
    if (!formData.hostname || !formData.username || !formData.keyPath) {
      alert('ホスト名、ユーザー名、秘密鍵ファイルパスを入力してください。');
      return;
    }

    setIsTestingConnection(true);
    setTestResult('');

    try {
      const result = await testSshConnection(formData);
      setTestResult(result);
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      setTestResult(`❌ 接続テスト失敗: ${errorMessage}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSettingsSave = async () => {
    // 必須フィールドのチェック
    if (!formData.hostname || !formData.username || !formData.keyPath || !formData.remoteFolder) {
      alert('ホスト名、ユーザー名、秘密鍵ファイルパス、リモートフォルダパスを入力してください。');
      return;
    }

    setIsSaving(true);

    try {
      const backupConfig: BackupConfig = {
        ssh: {
          hostname: formData.hostname,
          port: formData.port,
          username: formData.username,
          key_path: formData.keyPath,
        },
        remote_folder: formData.remoteFolder,
        local_folder: formData.localFolder,
      };

      const settings: AppSettings = {
        backup_configs: [backupConfig],
        default_local_backup_path: formData.localFolder || undefined,
        auto_backup_enabled: false,
        auto_backup_interval_hours: 24,
      };

      await saveSettings(settings);
      alert('✅ 設定を保存しました！');
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      alert(`設定の保存に失敗: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  // PIN認証ハンドラ
  const handlePinSetupSuccess = async () => {
    setShowPinSetup(false);
    setPinMessage('✅ PINが正常に設定されました');
    await checkPinStatus();
    // メッセージを3秒後に自動消去
    setTimeout(() => setPinMessage(''), 3000);
  };

  const handlePinDisableSuccess = async () => {
    setShowPinDisable(false);

    try {
      await disablePin();
      setPinMessage('✅ PINが無効化されました');
    } catch (error) {
      setPinMessage('❌ PIN無効化に失敗しました: ' + String(error));
    }

    // メッセージを3秒後に自動消去
    setTimeout(() => setPinMessage(''), 3000);
  };

  return (
    <div className="app">
      <div className="modern-header">
        <div className="header-content">
          <div className="header-icon">
            <Settings className="w-12 h-12 text-white" />
          </div>
          <div className="header-text">
            <h1 className="header-title">設定</h1>
            <p className="header-description">SSH/SFTP接続設定とバックアップ設定を管理</p>
          </div>
        </div>
      </div>

      <div className="settings-content">
        {/* PIN認証設定セクション */}
        <div className="modern-card">
          <div className="card-header">
            <Shield className="w-6 h-6 text-green-600" />
            <h2 className="card-title">セキュリティ設定</h2>
          </div>

          <div style={{
            padding: '1.5rem',
            border: '1px solid #e0e0e0',
            borderRadius: '0.75rem',
            backgroundColor: '#fafafa',
            marginBottom: '2rem'
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>PIN認証</h3>
              <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.9rem' }}>
                アプリケーションの起動時にPIN認証を要求してセキュリティを向上させます
              </p>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1rem',
                backgroundColor: isPinEnabled ? '#e8f5e8' : '#fff3e0',
                borderRadius: '0.5rem',
                border: `1px solid ${isPinEnabled ? '#4caf50' : '#ff9800'}`,
                marginBottom: '1rem'
              }}>
                <div style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}>
                  {isPinEnabled ? <Lock className="w-6 h-6 text-green-600" /> : <Unlock className="w-6 h-6 text-orange-500" />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 'bold', color: isPinEnabled ? '#2e7d32' : '#f57c00' }}>
                    PIN認証: {isPinEnabled ? '有効' : '無効'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>
                    {isPinEnabled
                      ? 'アプリケーション起動時にPIN入力が必要です'
                      : 'アプリケーションは自由にアクセスできます'
                    }
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {!isPinEnabled ? (
                  <button
                    onClick={() => setShowPinSetup(true)}
                    className="action-button"
                    style={{
                      backgroundColor: '#4caf50',
                      color: '#fff',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <Lock className="w-4 h-4" />
                    PIN認証を有効化
                  </button>
                ) : (
                  <button
                    onClick={() => setShowPinDisable(true)}
                    className="action-button"
                    style={{
                      backgroundColor: '#f44336',
                      color: '#fff',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <Unlock className="w-4 h-4" />
                    PIN認証を無効化
                  </button>
                )}
              </div>
            </div>

            <div style={{
              padding: '1rem',
              backgroundColor: '#e3f2fd',
              borderRadius: '0.5rem',
              fontSize: '0.9rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.5rem 0' }}>
                <Shield className="w-4 h-4 text-blue-600" />
                <h4 style={{ margin: 0, color: '#1976d2' }}>セキュリティについて</h4>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#424242' }}>
                <li>PIN認証はArgon2アルゴリズムで安全に暗号化されます</li>
                <li>3回間違えると15分間ロックアウトされます</li>
                <li>PINは設定ファイルに暗号化して保存されます</li>
                <li>アプリケーション再起動時にPIN入力が必要になります</li>
              </ul>
            </div>
          </div>
        </div>

        <SettingsForm
          data={formData}
          onChange={handleInputChange}
          onKeyFileSelection={handleKeyFileSelection}
          onLocalFolderSelection={handleLocalFolderSelection}
        />

        <div className="settings-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <Search className="w-6 h-6 text-blue-600" />
            <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#1e293b', fontWeight: '700' }}>接続テスト</h2>
          </div>
          <div className="settings-actions">
            <div className="action-buttons">
              <button
                className="test-button"
                onClick={handleConnectionTest}
                disabled={isTestingConnection || !formData.hostname || !formData.username || !formData.keyPath}
              >
                {isTestingConnection ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    接続テスト中...
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4" />
                    SSH接続テスト
                  </>
                )}
              </button>
            </div>
          </div>

          {testResult && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: testResult.includes('❌') ? '#ffebee' : '#e8f5e8',
              borderRadius: '0.5rem',
              whiteSpace: 'pre-wrap'
            }}>
              {testResult}
            </div>
          )}
        </div>

        <div className="settings-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <Save className="w-6 h-6 text-green-600" />
            <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#1e293b', fontWeight: '700' }}>設定保存</h2>
          </div>
          <div className="settings-actions">
            <div className="action-buttons">
              <button
                className="save-button"
                onClick={handleSettingsSave}
                disabled={isSaving || !formData.hostname || !formData.username || !formData.keyPath || !formData.remoteFolder}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    設定を保存
                  </>
                )}
              </button>
              <a href="/" className="action-link">
                <button className="action-button">
                  <Home className="w-4 h-4" />
                  メインページに戻る
                </button>
              </a>
            </div>
          </div>
        </div>

        <div className="settings-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Info className="w-6 h-6 text-yellow-600" />
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#92400e', fontWeight: '700' }}>重要な設定情報</h2>
          </div>
          <ul className="info-list">
            <li><strong>X-Server:</strong> SSH接続にはポート10022を使用してください</li>
            <li><strong>認証:</strong> パスワード認証は無効化されているため、公開鍵認証が必須です</li>
            <li><strong>秘密鍵:</strong> 秘密鍵ファイルは適切な権限（600）で保存してください</li>
            <li><strong>パス:</strong> リモートフォルダパスは絶対パスで指定してください</li>
            <li><strong>セキュリティ:</strong> 設定は暗号化されてローカルに保存されます</li>
          </ul>
        </div>
      </div>

      <div className="footer">
        <p>© 2025 Kyosho Backup - Cross-platform Server Backup Tool</p>
      </div>

      {/* PIN関連メッセージ表示 */}
      {pinMessage && (
        <div style={{
          position: 'fixed',
          top: '2rem',
          right: '2rem',
          padding: '1rem 1.5rem',
          backgroundColor: pinMessage.includes('✅') ? '#e8f5e8' : '#ffebee',
          color: pinMessage.includes('✅') ? '#2e7d32' : '#c62828',
          borderRadius: '0.5rem',
          border: `1px solid ${pinMessage.includes('✅') ? '#4caf50' : '#f44336'}`,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          fontSize: '0.95rem',
          fontWeight: 'bold'
        }}>
          {pinMessage}
        </div>
      )}

      {/* PIN設定モーダル */}
      <PinAuthModal
        isOpen={showPinSetup}
        mode="setup"
        onSuccess={handlePinSetupSuccess}
        onCancel={() => setShowPinSetup(false)}
        title="PIN認証の設定"
      />

      {/* PIN無効化確認モーダル */}
      <PinAuthModal
        isOpen={showPinDisable}
        mode="verify"
        onSuccess={handlePinDisableSuccess}
        onCancel={() => setShowPinDisable(false)}
        title="PIN認証の無効化"
      />
    </div>
  );
};

export default SettingsPage;