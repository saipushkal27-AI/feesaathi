import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/auth/me');
      setUser(data.user || null);
      setProfile(data.profile || null);
      return data;
    } catch {
      setUser(null);
      setProfile(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setUser(null);
    setProfile(null);
  }, []);
  return (
    <AuthContext.Provider value={{ user, profile, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() { return useContext(AuthContext); }
