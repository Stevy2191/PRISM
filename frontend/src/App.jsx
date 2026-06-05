import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketNew from './pages/TicketNew';
import TicketDetail from './pages/TicketDetail';
import Projects from './pages/Projects';
import ProjectNew from './pages/ProjectNew';
import ProjectDetail from './pages/ProjectDetail';
import AdminUsers from './pages/AdminUsers';
import AdminDepartments from './pages/AdminDepartments';
import AdminApiKeys from './pages/AdminApiKeys';
import AdminSettings from './pages/AdminSettings';
import Reports from './pages/Reports';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/tickets" element={<Tickets />} />
        <Route path="/tickets/new" element={<TicketNew />} />
        <Route path="/tickets/:id" element={<TicketDetail />} />

        <Route path="/projects" element={<Projects />} />
        <Route
          path="/projects/new"
          element={
            <ProtectedRoute roles={['admin', 'technician']}>
              <ProjectNew />
            </ProtectedRoute>
          }
        />
        <Route path="/projects/:id" element={<ProjectDetail />} />

        <Route
          path="/reports"
          element={
            <ProtectedRoute roles={['admin', 'technician']}>
              <Reports />
            </ProtectedRoute>
          }
        />

        {/* Admin */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/departments"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminDepartments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/apikeys"
          element={
            <ProtectedRoute>
              <AdminApiKeys />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminSettings />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
