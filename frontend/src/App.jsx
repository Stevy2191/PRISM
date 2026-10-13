import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import SettingsShell from './components/settings/SettingsShell';
import { allRoutes, REDIRECTS } from './pages/settings/registry';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import SurveyPage from './pages/SurveyPage';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/tickets/Tickets';
import TicketNew from './pages/tickets/TicketNew';
import TicketDetail from './pages/tickets/TicketDetail';
import Projects from './pages/Projects';
import ProjectNew from './pages/ProjectNew';
import ProjectDetail from './pages/projects/ProjectDetail';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import CompaniesList from './pages/companies/CompaniesList';
import CompanyPage from './pages/companies/CompanyPage';
import Assets from './pages/Assets';
import AssetDetail from './pages/AssetDetail';
import Licenses from './pages/assets/Licenses';
import LicenseDetail from './pages/assets/LicenseDetail';
import Contracts from './pages/assets/Contracts';
import ContractDetail from './pages/assets/ContractDetail';
import Reports from './pages/Reports';
import Calendar from './pages/Calendar';
import KnowledgeBase from './pages/KnowledgeBase';
import ArticleEditor from './pages/ArticleEditor';
import ArticleView from './pages/ArticleView';
import KbPortal from './pages/kb/KbPortal';
import KbPortalArticle from './pages/kb/KbPortalArticle';
import NotFound from './pages/NotFound';

// Settings hub + sections
import SettingsHome from './pages/settings/SettingsHome';
import CompanyProfile from './pages/settings/CompanyProfile';
import SettingsStatuses from './pages/settings/Statuses';
import SettingsBusinessHours from './pages/settings/BusinessHours';
import SettingsHolidays from './pages/settings/Holidays';
import SettingsTeams from './pages/settings/Teams';
import SettingsPreferences from './pages/settings/Preferences';
import SettingsAbout from './pages/settings/About';
import SettingsLayouts from './pages/settings/Layouts';
import SettingsAssetCategories from './pages/settings/AssetCategories';
import SettingsAssetAlerts from './pages/settings/AssetAlerts';
import SettingsTimeTracking from './pages/settings/TimeTracking';
import SettingsWorkTypes from './pages/settings/WorkTypes';
import SettingsSingleSignOn from './pages/settings/SingleSignOn';
import SLAs from './pages/settings/SLAs';
import Schedules from './pages/settings/Schedules';
import SettingsImport from './pages/settings/Import';
import SettingsExport from './pages/settings/Export';
import SettingsNotifications from './pages/settings/Notifications';
import WorkflowRules from './pages/settings/WorkflowRules';
import WorkflowRuleEditor from './pages/settings/WorkflowRuleEditor';
import DirectorySync from './pages/settings/DirectorySync';
import CalendarIntegration from './pages/settings/CalendarIntegration';
import CustomerHappiness from './pages/settings/CustomerHappiness';

// Existing admin pages (reached via the Settings hub)
import AdminUsers from './pages/AdminUsers';
import UserDetail from './pages/UserDetail';
import AdminRoles from './pages/AdminRoles';
import RoleEditor from './pages/RoleEditor';
import AdminDepartments from './pages/AdminDepartments';
import AdminBlueprints from './pages/AdminBlueprints';
import AdminApiKeys from './pages/AdminApiKeys';
import SettingsDirectory from './pages/settings/Directory';
import SettingsIncomingEmail from './pages/settings/IncomingEmail';
import SettingsOutgoingEmail from './pages/settings/OutgoingEmail';
import SettingsSystemInfo from './pages/settings/SystemInfo';
import EmailLog from './pages/settings/EmailLog';
import AccessRestricted from './components/AccessRestricted';
import { useAuth } from './context/AuthContext';
import AuditLog from './pages/settings/AuditLog';

const staff = (el) => <ProtectedRoute roles={['admin', 'technician']}>{el}</ProtectedRoute>;
const perm = (el, keys) => <ProtectedRoute permission={keys}>{el}</ProtectedRoute>;

// Sign-in, mail and integration settings need an Owner (user decision
// 2026-10-11); the server refuses everyone else too.
function OwnerOnly({ children }) {
  const { isOwner } = useAuth();
  return isOwner ? children : <AccessRestricted message="Changing these settings needs an Owner." />;
}

const TICKETS_KEYS = ['tickets.view_own', 'tickets.view_department', 'tickets.view_all'];
const PROJECTS_KEYS = ['projects.view_own', 'projects.view_department', 'projects.view_all'];
// Calendar aggregates both tickets and projects/tasks — reachable by anyone
// who can view either, not just ticket viewers (mirrors the backend's
// /calendar/events route gate).
const CALENDAR_KEYS = [...TICKETS_KEYS, ...PROJECTS_KEYS];
const CONTACTS_KEYS = ['people.view_own_department', 'people.view_all'];
const ASSETS_KEYS = ['assets.view'];
const REPORTS_KEYS = ['reports.view_own', 'reports.view_department', 'reports.view_all'];
const KB_KEYS = ['kb.view'];
const COMPANIES_KEYS = ['companies.view'];

// Which component each registry page (and sub-page) renders. The registry
// holds its access; settingsElement turns that into the same guards as
// before the redesign (spec: Settings redesign, "One source of truth").
const SETTINGS_COMPONENTS = {
  preferences: SettingsPreferences, about: SettingsAbout, company: CompanyProfile,
  companies: () => <CompaniesList inSettings />,
  users: AdminUsers, 'user-detail': UserDetail, teams: SettingsTeams, departments: AdminDepartments,
  roles: AdminRoles, 'role-new': RoleEditor, 'role-edit': RoleEditor, 'api-keys': AdminApiKeys,
  statuses: SettingsStatuses, 'custom-fields': SettingsLayouts, blueprints: AdminBlueprints,
  'workflow-rules': WorkflowRules,
  'workflow-rule-new': WorkflowRuleEditor, 'workflow-rule-edit': WorkflowRuleEditor,
  notifications: SettingsNotifications, 'customer-happiness': CustomerHappiness,
  slas: SLAs, 'business-hours': SettingsBusinessHours, holidays: SettingsHolidays,
  'time-tracking': SettingsTimeTracking, 'work-types': SettingsWorkTypes,
  'asset-categories': SettingsAssetCategories, 'asset-alerts': SettingsAssetAlerts,
  'single-sign-on': SettingsSingleSignOn, directory: SettingsDirectory, 'directory-sync': DirectorySync,
  'incoming-email': SettingsIncomingEmail, 'outgoing-email': SettingsOutgoingEmail, 'email-log': EmailLog,
  calendar: CalendarIntegration, schedules: Schedules, import: SettingsImport,
  export: SettingsExport, 'audit-log': AuditLog, system: SettingsSystemInfo,
};

function settingsElement(id, access) {
  const Component = SETTINGS_COMPONENTS[id];
  const page = access.owner ? <OwnerOnly><Component /></OwnerOnly> : <Component />;
  return access.roles || access.permission
    ? <ProtectedRoute roles={access.roles} permission={access.permission}>{page}</ProtectedRoute>
    : page;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
      {/* Fully public — a contact reaches this via an emailed CSAT survey link, no PRISM login. */}
      <Route path="/survey/:token" element={<SurveyPage />} />
      {/* Fully public knowledge base portal — published + public articles only. */}
      <Route path="/kb" element={<KbPortal />} />
      <Route path="/kb/a/:slug" element={<KbPortalArticle />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/tickets" element={perm(<Tickets />, TICKETS_KEYS)} />
        <Route path="/tickets/new" element={perm(<TicketNew />, TICKETS_KEYS)} />
        <Route path="/tickets/:id" element={perm(<TicketDetail />, TICKETS_KEYS)} />

        <Route path="/contacts" element={perm(<Contacts />, CONTACTS_KEYS)} />
        <Route path="/contacts/:id" element={perm(<ContactDetail />, CONTACTS_KEYS)} />

        <Route path="/companies" element={perm(<CompaniesList />, COMPANIES_KEYS)} />
        <Route path="/companies/:id" element={perm(<CompanyPage />, COMPANIES_KEYS)} />

        <Route path="/assets" element={perm(<Assets />, ASSETS_KEYS)} />
        <Route path="/assets/licenses" element={perm(<Licenses />, ASSETS_KEYS)} />
        <Route path="/assets/licenses/:id" element={perm(<LicenseDetail />, ASSETS_KEYS)} />
        <Route path="/assets/contracts" element={perm(<Contracts />, ASSETS_KEYS)} />
        <Route path="/assets/contracts/:id" element={perm(<ContractDetail />, ASSETS_KEYS)} />
        <Route path="/assets/:id" element={perm(<AssetDetail />, ASSETS_KEYS)} />

        <Route path="/projects" element={perm(<Projects />, PROJECTS_KEYS)} />
        <Route path="/projects/new" element={staff(<ProjectNew />)} />
        <Route path="/projects/:id" element={perm(<ProjectDetail />, PROJECTS_KEYS)} />

        <Route path="/reports" element={perm(<Reports />, REPORTS_KEYS)} />
        <Route path="/calendar" element={perm(<Calendar />, CALENDAR_KEYS)} />

        <Route path="/knowledge" element={perm(<KnowledgeBase />, KB_KEYS)} />
        <Route path="/knowledge/new" element={perm(<ArticleEditor />, KB_KEYS)} />
        <Route path="/knowledge/:id" element={perm(<ArticleView />, KB_KEYS)} />
        <Route path="/knowledge/:id/edit" element={perm(<ArticleEditor />, KB_KEYS)} />

        {/* Settings: the menu and the routes come from one registry (spec:
            Settings redesign), so a menu entry always matches its guard. */}
        <Route element={<SettingsShell />}>
          <Route path="/settings" element={<SettingsHome />} />
          {allRoutes().map((r) => <Route key={r.path} path={r.path} element={settingsElement(r.id, r.access)} />)}
          {REDIRECTS.map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
