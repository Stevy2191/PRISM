import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-navy-50 text-center">
      <p className="text-6xl font-bold text-prism">404</p>
      <p className="mt-2 text-navy-600">This page could not be found.</p>
      <Link to="/dashboard" className="btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  );
}
