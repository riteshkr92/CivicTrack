import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loginUser, registerUser, fetchCurrentUser } from '../services/api';

const AuthContext = createContext(null);

const TOKEN_STORAGE_KEY = 'civictrack_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  });
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Authenticated state requires both valid token and verified user profile
  const isAuthenticated = Boolean(token && user);
  // Role is strictly derived from verified backend user document
  const role = user?.role || null;

  // Restore authenticated session on app mount/page reload via verified GET /api/auth/me
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      let storedToken = null;
      try {
        storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      } catch (e) {
        storedToken = null;
      }

      if (!storedToken) {
        if (isMounted) {
          setToken(null);
          setUser(null);
          setIsInitializing(false);
        }
        return;
      }

      try {
        const result = await fetchCurrentUser(storedToken);
        if (isMounted) {
          if (result.ok && result.user) {
            setToken(storedToken);
            setUser(result.user);
          } else {
            // Token expired or invalid
            try {
              localStorage.removeItem(TOKEN_STORAGE_KEY);
            } catch (e) {}
            setToken(null);
            setUser(null);
          }
        }
      } catch (err) {
        if (isMounted) {
          try {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
          } catch (e) {}
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Handle user login
   */
  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setAuthError(null);

    const result = await loginUser({ email, password });
    setIsLoading(false);

    if (result.ok) {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
      } catch (e) {
        // Fallback if local storage restricted
      }
      setToken(result.token);
      setUser(result.user);
      return { success: true, user: result.user };
    }

    setAuthError(result.errorMessage);
    return { success: false, errorMessage: result.errorMessage };
  }, []);

  /**
   * Handle citizen registration
   */
  const register = useCallback(async (name, email, password) => {
    setIsLoading(true);
    setAuthError(null);

    const result = await registerUser({ name, email, password });
    setIsLoading(false);

    if (result.ok) {
      return { success: true, user: result.user, message: result.message };
    }

    setAuthError(result.errorMessage);
    return { success: false, errorMessage: result.errorMessage };
  }, []);

  /**
   * Handle user logout
   */
  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (e) {}
    setToken(null);
    setUser(null);
    setAuthError(null);
  }, []);

  /**
   * Update the in-memory user document when profile changes
   */
  const updateUser = useCallback((updatedUser) => {
    setUser((prev) => (prev ? { ...prev, ...updatedUser } : updatedUser));
  }, []);

  /**
   * Clear invalid authentication when a protected API returns 401
   */
  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  const value = {
    token,
    user,
    role,
    isAuthenticated,
    isLoading,
    isInitializing,
    authError,
    setAuthError,
    login,
    register,
    logout,
    updateUser,
    handleUnauthorized
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
