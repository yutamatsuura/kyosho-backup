import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BackupHistoryEntry, BackupStatistics } from '../types/tauri';
import {
  BarChart3,
  RefreshCw,
  Trash2,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Pause,
  Clock,
  FileText,
  Server,
  User
} from 'lucide-react';

const HistoryPage: React.FC = () => {
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);
  const [statistics, setStatistics] = useState<BackupStatistics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // データを読み込む
  const loadData = async () => {
    setIsLoading(true);
    setError('');

    try {
      const [historyData, statsData] = await Promise.all([
        invoke<BackupHistoryEntry[]>('get_backup_history'),
        invoke<BackupStatistics>('get_backup_statistics')
      ]);

      setHistory(historyData);
      setStatistics(statsData);
    } catch (error) {
      setError(`データ読み込みエラー: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 履歴エントリを削除
  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('このバックアップ履歴を削除しますか？')) {
      return;
    }

    try {
      const success = await invoke<boolean>('delete_backup_entry', {
        entryId
      });

      if (success) {
        await loadData(); // データを再読み込み
      } else {
        alert('履歴の削除に失敗しました');
      }
    } catch (error) {
      alert(`削除エラー: ${error}`);
    }
  };

  // 全履歴を削除
  const handleClearHistory = async () => {
    if (!confirm('全てのバックアップ履歴を削除しますか？この操作は元に戻せません。')) {
      return;
    }

    try {
      await invoke('clear_backup_history');
      await loadData(); // データを再読み込み
    } catch (error) {
      alert(`履歴削除エラー: ${error}`);
    }
  };

  // 日時をフォーマット
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('ja-JP');
  };

  // 時間をフォーマット
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    return `${remainingSeconds}秒`;
  };

  // ステータスに応じたスタイル
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'Success':
        return { color: '#4caf50', background: '#e8f5e8' };
      case 'Failed':
        return { color: '#f44336', background: '#ffebee' };
      default:
        return { color: '#ff9800', background: '#fff3e0' };
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <BarChart3 className="w-12 h-12 text-blue-600 animate-pulse" />
          </div>
          <p style={{ fontSize: '1.2rem', color: '#666' }}>履歴データ読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="modern-header">
        <div className="header-content">
          <div className="header-icon">
            <BarChart3 className="w-12 h-12 text-white" />
          </div>
          <div className="header-text">
            <h1 className="header-title">バックアップ履歴</h1>
            <p className="header-description">バックアップの実行履歴と統計情報</p>
          </div>
        </div>
      </div>

      <div className="settings-content">
        <header style={{ marginBottom: '2rem' }}>
        <div className="action-buttons">
          <a href="/" className="action-link">
            <button className="action-button">
              <ArrowLeft className="w-4 h-4" />
              メインページに戻る
            </button>
          </a>
          <button
            onClick={loadData}
            className="action-button"
          >
            <RefreshCw className="w-4 h-4" />
            更新
          </button>
          {history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="action-button delete-button"
            >
              <Trash2 className="w-4 h-4" />
              全削除
            </button>
          )}
        </div>
      </header>

      {error && (
        <div style={{
          padding: '1rem',
          background: '#ffebee',
          color: '#d32f2f',
          borderRadius: '0.5rem',
          marginBottom: '2rem'
        }}>
          {error}
        </div>
      )}

      {/* 統計情報 */}
      {statistics && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <BarChart3 className="w-6 h-6 text-blue-600" />
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>統計情報</h2>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem'
          }}>
            <div style={{
              padding: '1rem',
              background: '#e3f2fd',
              borderRadius: '0.5rem',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1976d2' }}>
                {statistics.total_backups.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>総バックアップ数</div>
            </div>
            <div style={{
              padding: '1rem',
              background: '#e8f5e8',
              borderRadius: '0.5rem',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#4caf50' }}>
                {statistics.success_rate.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>成功率</div>
            </div>
            <div style={{
              padding: '1rem',
              background: '#f3e5f5',
              borderRadius: '0.5rem',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#9c27b0' }}>
                {formatDuration(statistics.total_time_spent)}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>総実行時間</div>
            </div>
          </div>
          {statistics.last_backup_timestamp > 0 && (
            <p style={{ color: '#666', fontSize: '0.9rem' }}>
              最終バックアップ: {formatDate(statistics.last_backup_timestamp)}
            </p>
          )}
        </section>
      )}

      {/* 履歴リスト */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FileText className="w-6 h-6 text-blue-600" />
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>バックアップ履歴</h2>
        </div>
        {history.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            background: '#f5f5f5',
            borderRadius: '0.5rem',
            color: '#666'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <FileText className="w-12 h-12 text-gray-400" />
            </div>
            <p>バックアップ履歴がありません</p>
            <p style={{ fontSize: '0.9rem' }}>最初のバックアップを実行すると履歴が表示されます</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gap: '1rem'
          }}>
            {history.map((entry) => (
              <div key={entry.id} style={{
                padding: '1.5rem',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '0.5rem',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '1rem'
                }}>
                  <div>
                    <h3 style={{
                      margin: '0 0 0.5rem 0',
                      fontSize: '1.1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span
                        style={{
                          ...getStatusStyle(entry.status),
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                      >
                        {entry.status === 'Success' ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            成功
                          </>
                        ) : entry.status === 'Failed' ? (
                          <>
                            <XCircle className="w-3 h-3" />
                            失敗
                          </>
                        ) : (
                          <>
                            <Pause className="w-3 h-3" />
                            キャンセル
                          </>
                        )}
                      </span>
                      {formatDate(entry.timestamp)}
                    </h3>
                    <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: '#666' }}>
                      <strong>リモート:</strong> {entry.ssh_user}@{entry.ssh_host}
                    </p>
                    <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: '#666' }}>
                      <strong>対象:</strong> {entry.remote_path}
                    </p>
                    <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: '#666' }}>
                      <strong>保存先:</strong> {entry.local_path}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    style={{
                      background: '#f44336',
                      color: 'white',
                      border: 'none',
                      padding: '0.5rem',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="この履歴を削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem',
                  padding: '1rem',
                  background: '#f8f9fa',
                  borderRadius: '0.25rem'
                }}>
                  <div>
                    <strong>転送ファイル数</strong><br />
                    <span style={{ fontSize: '1.2rem', color: '#2196f3' }}>
                      {entry.transferred_files.toLocaleString()}個
                    </span>
                  </div>
                  <div>
                    <strong>実行時間</strong><br />
                    <span style={{ fontSize: '1.2rem', color: '#4caf50' }}>
                      {formatDuration(entry.elapsed_seconds)}
                    </span>
                  </div>
                </div>

                {entry.message && (
                  <div style={{
                    padding: '0.75rem',
                    background: entry.status === 'Success' ? '#e8f5e8' : '#ffebee',
                    borderRadius: '0.25rem',
                    fontSize: '0.9rem',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {entry.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      </div>

      <footer className="footer">
        <p>© 2025 Kyosho Backup - Cross-platform Server Backup Tool</p>
      </footer>
    </div>
  );
};

export default HistoryPage;