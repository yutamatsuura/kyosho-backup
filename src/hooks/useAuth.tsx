import React, { createContext, useContext, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface AuthContextType {
  isAuthenticated: boolean;
  isPinEnabled: boolean;
  isLoading: boolean;
  authenticate: (pin: string) => Promise<boolean>;
  setupPin: (pin: string) => Promise<void>;
  disablePin: () => Promise<void>;
  logout: () => void;
  checkPinStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isPinEnabled, setIsPinEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // アプリケーション起動時にPIN状態を確認
  useEffect(() => {
    checkPinStatus();
  }, []);

  const checkPinStatus = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const pinEnabled = await invoke<boolean>('is_pin_enabled');
      setIsPinEnabled(pinEnabled);

      // PINが無効な場合は自動的に認証済み状態にする
      if (!pinEnabled) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('PIN状態確認エラー:', error);
      setIsPinEnabled(false);
      setIsAuthenticated(true); // エラー時はアクセス許可（開発環境考慮）
    } finally {
      setIsLoading(false);
    }
  };

  const authenticate = async (pin: string): Promise<boolean> => {
    try {
      const isValid = await invoke<boolean>('verify_pin', { pin });
      if (isValid) {
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('PIN認証エラー:', error);
      throw error;
    }
  };

  const setupPin = async (pin: string): Promise<void> => {
    try {
      await invoke('setup_pin', { pin });
      setIsPinEnabled(true);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('PIN設定エラー:', error);
      throw error;
    }
  };

  const disablePin = async (): Promise<void> => {
    try {
      await invoke('disable_pin');
      setIsPinEnabled(false);
      setIsAuthenticated(true);
    } catch (error) {
      console.error('PIN無効化エラー:', error);
      throw error;
    }
  };

  const logout = (): void => {
    if (isPinEnabled) {
      setIsAuthenticated(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      isPinEnabled,
      isLoading,
      authenticate,
      setupPin,
      disablePin,
      logout,
      checkPinStatus
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};