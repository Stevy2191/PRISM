import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Spinner from './Spinner';

// Guards routes. `roles` (optional) restricts to specific legacy roles.
// `permission` (optional array) restricts to users granted ANY of the given
// permission keys — used for pages reachable via a permission-gated Settings
// card, so a non-admin-enum role holding the right permission isn't shown a
// card that then redirects them away.
export default function ProtectedRoute({ children, roles, permission }) {
  const { user, loading, hasAnyPermission } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();

  const deniedByRole = !!user && roles && !roles.includes(user.role);
  const deniedByPermission = !!user && permission && !hasAnyPermission(permission);
  const denied = deniedByRole || deniedByPermission;

  // Fire the toast as a side effect (not during render), keyed on the path
  // so it only shows once per denied navigation, not on every re-render.
  useEffect(() => {
    if (denied) showToast("You don't have permission to access that page.", 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denied, location.pathname]);

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

  if (denied) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
