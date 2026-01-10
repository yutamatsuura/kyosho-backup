import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, Shield, Clock } from 'lucide-react';

interface PinAuthModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  mode: 'setup' | 'verify';
  title?: string;
}

const PinAuthModal: React.FC<PinAuthModalProps> = ({
  isOpen,
  onSuccess,
  onCancel,
  mode,
  title
}) => {
  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lockoutMinutes, setLockoutMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setConfirmPin('');
      setError('');
      setLockoutMinutes(null);

      if (mode === 'verify') {
        checkLockoutStatus();
      }
    }
  }, [isOpen, mode]);

  const checkLockoutStatus = async () => {
    try {
      const remaining = await invoke<number | null>('get_lockout_remaining_minutes');
      setLockoutMinutes(remaining);
    } catch (error) {
      console.error('ロックアウト状態確認エラー:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pin.length < 4) {
      setError('PINは4文字以上で入力してください');
      return;
    }

    if (!/^\d+$/.test(pin)) {
      setError('PINは数字のみで入力してください');
      return;
    }

    if (mode === 'setup' && pin !== confirmPin) {
      setError('PINが一致しません');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (mode === 'setup') {
        await invoke('setup_pin', { pin });
        onSuccess();
      } else {
        const isValid = await invoke<boolean>('verify_pin', { pin });
        if (isValid) {
          onSuccess();
        } else {
          setError('PINが正しくありません');
        }
      }
    } catch (error) {
      setError(String(error));

      // 認証失敗の場合はロックアウト状態を再確認
      if (mode === 'verify') {
        await checkLockoutStatus();
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        padding: '2rem',
        borderRadius: '1rem',
        minWidth: '400px',
        maxWidth: '500px',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', margin: '0 0 1.5rem 0' }}>
          {mode === 'setup' ? <Lock className="w-6 h-6 text-blue-600" /> : <Shield className="w-6 h-6 text-green-600" />}
          <h2 style={{ margin: 0, textAlign: 'center' }}>
            {title || (mode === 'setup' ? 'PIN設定' : 'PIN認証')}
          </h2>
        </div>

        {lockoutMinutes && (
          <div style={{
            padding: '1rem',
            backgroundColor: '#ffebee',
            borderRadius: '0.5rem',
            border: '1px solid #f44336',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <Clock className="w-5 h-5 text-red-600" />
              <p style={{ margin: 0, color: '#c62828', fontWeight: 'bold' }}>
                ロックアウト中です
              </p>
            </div>
            <p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>
              あと{lockoutMinutes}分後に再試行できます
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              PIN（4-20文字の数字）
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN番号を入力"
              disabled={isLoading || !!lockoutMinutes}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '0.5rem',
                fontSize: '1.1rem',
                textAlign: 'center',
                letterSpacing: '0.2em'
              }}
              maxLength={20}
              autoComplete="off"
            />
          </div>

          {mode === 'setup' && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                PIN確認
              </label>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="PINを再度入力"
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  fontSize: '1.1rem',
                  textAlign: 'center',
                  letterSpacing: '0.2em'
                }}
                maxLength={20}
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <div style={{
              padding: '0.75rem',
              backgroundColor: '#ffebee',
              borderRadius: '0.5rem',
              border: '1px solid #f44336',
              marginBottom: '1rem',
              color: '#c62828'
            }}>
              ❌ {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '0.5rem',
                backgroundColor: '#f5f5f5',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isLoading || !!lockoutMinutes || !pin || (mode === 'setup' && !confirmPin)}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: 'none',
                borderRadius: '0.5rem',
                backgroundColor: isLoading || !!lockoutMinutes ? '#ccc' : '#2196f3',
                color: '#fff',
                cursor: isLoading || !!lockoutMinutes ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold'
              }}
            >
              {isLoading ? '処理中...' : (mode === 'setup' ? '設定' : '認証')}
            </button>
          </div>
        </form>

        {mode === 'setup' && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: '#e3f2fd',
            borderRadius: '0.5rem',
            fontSize: '0.9rem',
            color: '#1976d2'
          }}>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>📋 注意事項</p>
            <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
              <li>PINは4文字以上20文字以下の数字で設定してください</li>
              <li>3回間違えると15分間ロックアウトされます</li>
              <li>設定したPINは安全に管理してください</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PinAuthModal;