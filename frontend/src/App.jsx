import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import PersonalColorsSync from './components/PersonalColorsSync';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketNew from './pages/TicketNew';
import TicketDetail from './pages/TicketDetail';
import Projects from './pages/Projects';
import ProjectNew from './pages/ProjectNew';
import ProjectDetail from './pages/ProjectDetail';
import Reports from './pages/Reports';
import Calendar from './pages/Calendar';
import NotFound from './pages/NotFound';

// Settings hub + sections
import SettingsHub from './pages/SettingsHub';
import SettingsCompany from './pages/settings/Company';
import SettingsAppearance from './pages/settings/Appearance';
import SettingsStatuses from './pages/settings/Statuses';
import SettingsBusinessHours from './pages/settings/BusinessHours';
import SettingsHolidays from './pages/settings/Holidays';
import SettingsTeams from './pages/settings/Teams';
import SettingsModules from './pages/settings/Modules';
import SettingsPreferences from './pages/settings/Preferences';
import SettingsLayouts from './pages/settings/Layouts';
import Placeholder from './pages/settings/Placeholder';

// Existing admin pages (reached via the Settings hub)
import AdminUsers from './pages/AdminUsers';
import AdminDepartments from './pages/AdminDepartments';
import AdminBlueprints from './pages/AdminBlueprints';
import AdminApiKeys from './pages/AdminApiKeys';
import AdminSettings from './pages/AdminSettings';

const admin = (el) => <ProtectedRoute roles={['admin']}>{el}</ProtectedRoute>;
const staff = (el) => <ProtectedRoute roles={['admin', 'technician']}>{el}</ProtectedRoute>;

export default function App() {
  return (
    <>
    <PersonalColorsSync />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/tickets" element={<Tickets />} />
        <Route path="/tickets/new" element={<TicketNew />} />
        <Route path="/tickets/:id" element={<TicketDetail />} />

        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={staff(<ProjectNew />)} />
        <Route path="/projects/:id" element={<ProjectDetail />} />

        <Route path="/reports" element={staff(<Reports />)} />
        <Route path="/calendar" element={<Calendar />} />

        {/* Settings hub + sections */}
        <Route path="/settings" element={<SettingsHub />} />
        <Route path="/settings/preferences" element={<SettingsPreferences />} />
        <Route path="/settings/company" element={admin(<SettingsCompany />)} />
        <Route path="/settings/appearance" element={admin(<SettingsAppearance />)} />
        <Route path="/settings/statuses" element={admin(<SettingsStatuses />)} />
        <Route path="/settings/business-hours" element={admin(<SettingsBusinessHours />)} />
        <Route path="/settings/holidays" element={admin(<SettingsHolidays />)} />
        <Route path="/settings/teams" element={admin(<SettingsTeams />)} />
        <Route path="/settings/modules" element={admin(<SettingsModules />)} />
        <Route path="/settings/blueprints" element={staff(<AdminBlueprints />)} />

        {/* Existing admin pages */}
        <Route path="/admin/users" element={admin(<AdminUsers />)} />
        <Route path="/admin/departments" element={admin(<AdminDepartments />)} />
        <Route path="/admin/blueprints" element={staff(<AdminBlueprints />)} />
        <Route path="/admin/apikeys" element={<AdminApiKeys />} />
        <Route path="/admin/settings" element={admin(<AdminSettings />)} />

        {/* Placeholders for sections specified later */}
        <Route path="/settings/customer-happiness" element={staff(<Placeholder title="Customer Happiness" note="CSAT scores are available on the Reports page and on each ticket." />)} />
        <Route path="/settings/layouts" element={admin(<SettingsLayouts />)} />
        <Route path="/settings/email-templates" element={admin(<Placeholder title="Email Templates" />)} />
        <Route path="/settings/notifications" element={staff(<Placeholder title="Notifications" />)} />
        <Route path="/settings/general" element={admin(<Placeholder title="General Settings" note="System/LDAP configuration is shown read-only under Admin → General Settings." />)} />
        <Route path="/settings/time-tracking" element={staff(<Placeholder title="Time Tracking" note="Time logging is available on tickets and projects; summaries are on Reports." />)} />
        <Route path="/settings/assignment-rules" element={admin(<Placeholder title="Assignment Rules" />)} />
        <Route path="/settings/workflows" element={admin(<Placeholder title="Workflows" />)} />
        <Route path="/settings/macros" element={admin(<Placeholder title="Macros" />)} />
        <Route path="/settings/slas" element={admin(<Placeholder title="SLAs" />)} />
        <Route path="/settings/supervisor-rules" element={admin(<Placeholder title="Supervisor Rules" />)} />
        <Route path="/settings/schedules" element={admin(<Placeholder title="Schedules" />)} />
        <Route path="/settings/import" element={admin(<Placeholder title="Import" />)} />
        <Route path="/settings/export" element={admin(<Placeholder title="Export" />)} />
        <Route path="/settings/audit-log" element={admin(<Placeholder title="Audit Log" />)} />
        <Route path="/settings/recycle-bin" element={admin(<Placeholder title="Recycle Bin" />)} />
        <Route path="/settings/calendar-integration" element={admin(<Placeholder title="Calendar Integration" />)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}
