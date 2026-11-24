import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="mx-auto max-w-6xl px-5 py-16 text-mist">Loading…</p>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (roles && !user.roles.some((r) => roles.includes(r))) return <Navigate to="/" replace />;
  return children;
}
