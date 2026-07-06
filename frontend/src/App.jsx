import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketNew from './pages/TicketNew';
import TicketDetail from './pages/TicketDetail';
import Projects from './pages/Projects';
import ProjectNew from './pages/ProjectNew';
import ProjectDetail from './pages/ProjectDetail';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Reports from './pages/Reports';
import Calendar from './pages/Calendar';
import NotFound from './pages/NotFound';

// Settings hub + sections
import SettingsHub from './pages/SettingsHub';
import SettingsCompany from './pages/settings/Company';
import SettingsBranding from './pages/settings/Branding';
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
import UserDetail from './pages/UserDetail';
import AdminRoles from './pages/AdminRoles';
import RoleEditor from './pages/RoleEditor';
import AdminDepartments from './pages/AdminDepartments';
import AdminBlueprints from './pages/AdminBlueprints';
import AdminApiKeys from './pages/AdminApiKeys';
import AdminSettings from './pages/AdminSettings';
import AuditLog from './pages/settings/AuditLog';

const admin = (el) => <ProtectedRoute roles={['admin']}>{el}</ProtectedRoute>;
const staff = (el) => <ProtectedRoute roles={['admin', 'technician']}>{el}</ProtectedRoute>;
const perm = (el, keys) => <ProtectedRoute permission={keys}>{el}</ProtectedRoute>;

// These mirror the Settings-hub card visibility rules 1:1 (see SettingsHub.jsx)
// so a route is always reachable whenever its card is shown, and never
// reachable when it isn't.
const TICKETS_KEYS = ['tickets.view_own', 'tickets.view_department', 'tickets.view_all'];
const PROJECTS_KEYS = ['projects.view_own', 'projects.view_department', 'projects.view_all'];
const CONTACTS_KEYS = ['people.view_own_department', 'people.view_all'];
const REPORTS_KEYS = ['reports.view_own', 'reports.view_department', 'reports.view_all'];
const USERS_KEYS = ['people.view_all', 'people.create_users'];
const TEAMS_KEYS = ['people.view_all', 'people.manage_departments'];
const DEPARTMENTS_KEYS = ['people.manage_departments'];
const ROLES_KEYS = ['people.manage_roles'];
const BRANDING_KEYS = ['settings.manage_branding', 'settings.manage_system'];
const BUSINESS_HOURS_KEYS = ['settings.manage_business_hours'];
const STATUSES_KEYS = ['settings.manage_statuses'];
const SYSTEM_KEYS = ['settings.manage_system'];
const AUDIT_LOG_KEYS = ['settings.view_audit_log'];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/tickets" element={perm(<Tickets />, TICKETS_KEYS)} />
        <Route path="/tickets/new" element={perm(<TicketNew />, TICKETS_KEYS)} />
        <Route path="/tickets/:id" element={perm(<TicketDetail />, TICKETS_KEYS)} />

        <Route path="/contacts" element={perm(<Contacts />, CONTACTS_KEYS)} />
        <Route path="/contacts/:id" element={perm(<ContactDetail />, CONTACTS_KEYS)} />

        <Route path="/projects" element={perm(<Projects />, PROJECTS_KEYS)} />
        <Route path="/projects/new" element={staff(<ProjectNew />)} />
        <Route path="/projects/:id" element={perm(<ProjectDetail />, PROJECTS_KEYS)} />

        <Route path="/reports" element={perm(<Reports />, REPORTS_KEYS)} />
        <Route path="/calendar" element={perm(<Calendar />, TICKETS_KEYS)} />

        {/* Settings hub + sections */}
        <Route path="/settings" element={<SettingsHub />} />
        <Route path="/settings/preferences" element={<SettingsPreferences />} />
        <Route path="/settings/company" element={perm(<SettingsCompany />, BRANDING_KEYS)} />
        <Route path="/settings/branding" element={perm(<SettingsBranding />, BRANDING_KEYS)} />
        <Route path="/settings/statuses" element={perm(<SettingsStatuses />, STATUSES_KEYS)} />
        <Route path="/settings/business-hours" element={perm(<SettingsBusinessHours />, BUSINESS_HOURS_KEYS)} />
        <Route path="/settings/holidays" element={perm(<SettingsHolidays />, BUSINESS_HOURS_KEYS)} />
        <Route path="/settings/teams" element={perm(<SettingsTeams />, TEAMS_KEYS)} />
        <Route path="/settings/modules" element={perm(<SettingsModules />, SYSTEM_KEYS)} />
        <Route path="/settings/blueprints" element={staff(<AdminBlueprints />)} />

        {/* Existing admin pages */}
        <Route path="/admin/users" element={perm(<AdminUsers />, USERS_KEYS)} />
        {/* No route-level permission gate: any authenticated user may view
            their own profile here. UserDetail itself enforces self-or-
            people.edit_users for viewing someone else's (matching the
            backend's GET /users/:id check) and shows AccessRestricted on 403. */}
        <Route path="/admin/users/:id" element={<ProtectedRoute><UserDetail /></ProtectedRoute>} />
        <Route path="/admin/roles" element={perm(<AdminRoles />, ROLES_KEYS)} />
        <Route path="/admin/roles/new" element={perm(<RoleEditor />, ROLES_KEYS)} />
        <Route path="/admin/roles/:id" element={perm(<RoleEditor />, ROLES_KEYS)} />
        <Route path="/admin/departments" element={perm(<AdminDepartments />, DEPARTMENTS_KEYS)} />
        <Route path="/admin/blueprints" element={staff(<AdminBlueprints />)} />
        <Route path="/admin/apikeys" element={<AdminApiKeys />} />
        <Route path="/admin/settings" element={perm(<AdminSettings />, SYSTEM_KEYS)} />

        {/* Placeholders for sections specified later */}
        <Route path="/settings/customer-happiness" element={perm(<Placeholder title="Customer Happiness" note="CSAT scores are available on the Reports page and on each ticket." />, SYSTEM_KEYS)} />
        <Route path="/settings/layouts" element={perm(<SettingsLayouts />, SYSTEM_KEYS)} />
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
        <Route path="/settings/audit-log" element={perm(<AuditLog />, AUDIT_LOG_KEYS)} />
        <Route path="/settings/recycle-bin" element={admin(<Placeholder title="Recycle Bin" />)} />
        <Route path="/settings/calendar-integration" element={admin(<Placeholder title="Calendar Integration" />)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
