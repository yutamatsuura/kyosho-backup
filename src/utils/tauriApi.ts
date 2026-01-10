import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { AppSettings, SettingsFormData } from '../types/tauri';

/**
 * SSH接続テストを実行
 */
export async function testSshConnection(data: SettingsFormData): Promise<string> {
  try {
    const result = await invoke<string>('test_ssh_connection', {
      hostname: data.hostname,
      port: data.port,
      username: data.username,
      keyPath: data.keyPath,
    });
    return result;
  } catch (error) {
    throw new Error(error as string);
  }
}

/**
 * フォルダバックアップを実行
 */
export async function backupFolder(data: SettingsFormData): Promise<string> {
  try {
    const result = await invoke<string>('backup_folder', {
      hostname: data.hostname,
      port: data.port,
      username: data.username,
      keyPath: data.keyPath,
      remoteFolder: data.remoteFolder,
      localFolder: data.localFolder,
    });
    return result;
  } catch (error) {
    throw new Error(error as string);
  }
}

/**
 * 設定を保存
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await invoke('save_settings', { settings });
  } catch (error) {
    throw new Error(error as string);
  }
}

/**
 * 設定を読み込み
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const settings = await invoke<AppSettings>('load_settings');
    return settings;
  } catch (error) {
    throw new Error(error as string);
  }
}

/**
 * フォルダ選択ダイアログを開く
 */
export async function selectFolder(): Promise<string | null> {
  try {
    const result = await open({
      directory: true,
      multiple: false,
      title: 'フォルダを選択してください',
    });

    return Array.isArray(result) ? result[0] : result;
  } catch (error) {
    console.error('フォルダ選択エラー:', error);
    return null;
  }
}

/**
 * ファイル選択ダイアログを開く
 */
export async function selectFile(): Promise<string | null> {
  try {
    const result = await open({
      directory: false,
      multiple: false,
      title: 'ファイルを選択してください',
      filters: [
        {
          name: 'SSH Private Key',
          extensions: ['', 'pem', 'key', 'pub', 'ppk']
        }
      ]
    });

    return Array.isArray(result) ? result[0] : result;
  } catch (error) {
    console.error('ファイル選択エラー:', error);
    return null;
  }
}

/**
 * エラーメッセージを整形
 */
export function formatErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  } else if (error instanceof Error) {
    return error.message;
  } else {
    return '不明なエラーが発生しました';
  }
}