import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from './Spinner';

// Guards routes. `roles` (optional) restricts to specific legacy roles.
// `permission` (optional array) restricts to users granted ANY of the given
// permission keys — used for pages reachable via a permission-gated Settings
// card, so a non-admin-enum role holding the right permission isn't shown a
// card that then redirects them away.
export default function ProtectedRoute({ children, roles, permission }) {
  const { user, loading, hasAnyPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A local account pending a forced password change is locked to /change-password.
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (permission && !hasAnyPermission(permission)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
