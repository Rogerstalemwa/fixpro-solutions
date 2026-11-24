import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, refreshSession } from './api.js';

const AuthContext = createContext(null);
export const STAFF_ROLES = ['OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR', 'FINANCE_ADMIN', 'SUPER_ADMIN'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshSession().then(setUser).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (identifier, password) => {
    const { data } = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (form) => {
    const { data } = await api('/auth/register', { method: 'POST', body: form });
    setUser(data.user);
    return data.user;
  }, []);

  // Used after technician registration, where the API has already signed the new user in.
  const setSessionUser = useCallback((u) => setUser(u), []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setSessionUser, isStaff: !!user?.roles.some((r) => STAFF_ROLES.includes(r)) }),
    [user, loading, login, register, logout, setSessionUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
