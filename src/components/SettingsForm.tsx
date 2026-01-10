import React from 'react';
import { SettingsFormData } from '../types/tauri';
import { Server, Key, Folder, FolderOpen } from 'lucide-react';

interface SettingsFormProps {
  data: SettingsFormData;
  onChange: (field: keyof SettingsFormData, value: string | number) => void;
  onKeyFileSelection: () => void;
  onLocalFolderSelection: () => void;
}

const SettingsForm: React.FC<SettingsFormProps> = ({
  data,
  onChange,
  onKeyFileSelection,
  onLocalFolderSelection
}) => {
  return (
    <div className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <Server className="w-6 h-6 text-blue-600" />
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#1e293b', fontWeight: '700' }}>SSH/SFTP接続設定</h2>
      </div>

      <div className="input-group">
        <label htmlFor="hostname">ホスト名</label>
        <input
          id="hostname"
          type="text"
          className="setting-input"
          value={data.hostname}
          onChange={(e) => onChange('hostname', e.target.value)}
          placeholder="sv123.xserver.jp"
        />
      </div>

      <div className="input-group">
        <label htmlFor="port">ポート番号</label>
        <input
          id="port"
          type="number"
          className="setting-input"
          value={data.port}
          onChange={(e) => onChange('port', parseInt(e.target.value) || 10022)}
          placeholder="10022"
        />
      </div>

      <div className="input-group">
        <label htmlFor="username">ユーザー名</label>
        <input
          id="username"
          type="text"
          className="setting-input"
          value={data.username}
          onChange={(e) => onChange('username', e.target.value)}
          placeholder="your-username"
        />
      </div>

      <div className="input-group">
        <label htmlFor="keyPath">秘密鍵ファイルパス</label>
        <div className="file-input-group">
          <input
            id="keyPath"
            type="text"
            className="folder-input"
            value={data.keyPath}
            onChange={(e) => onChange('keyPath', e.target.value)}
            placeholder="/path/to/private_key"
            readOnly
          />
          <button
            type="button"
            className="select-button"
            onClick={onKeyFileSelection}
          >
            <Key className="w-4 h-4" />
            選択
          </button>
        </div>
      </div>

      <div className="input-group">
        <label htmlFor="remoteFolder">リモートフォルダパス</label>
        <input
          id="remoteFolder"
          type="text"
          className="setting-input"
          value={data.remoteFolder}
          onChange={(e) => onChange('remoteFolder', e.target.value)}
          placeholder="/home/your-username/your-domain.com/public_html"
        />
      </div>

      <div className="input-group">
        <label htmlFor="localFolder">ローカル保存先（デフォルト）</label>
        <div className="file-input-group">
          <input
            id="localFolder"
            type="text"
            className="folder-input"
            value={data.localFolder}
            onChange={(e) => onChange('localFolder', e.target.value)}
            placeholder="/path/to/backup/folder"
            readOnly
          />
          <button
            type="button"
            className="select-button"
            onClick={onLocalFolderSelection}
          >
            <FolderOpen className="w-4 h-4" />
            選択
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsForm;