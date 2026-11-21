import { Suspense } from 'react';
import {
  Routes, Route, Navigate, useParams,
} from 'react-router-dom';
import { lazyPage } from './utils/lazyPage';
import Spinner from './components/Spinner';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import SettingsShell from './components/settings/SettingsShell';
import { allRoutes, REDIRECTS, redirectTarget } from './pages/settings/registry';
import AccessRestricted from './components/AccessRestricted';
import { useAuth } from './context/AuthContext';

const Login = lazyPage(() => import('./pages/Login'));
const OAuthConsent = lazyPage(() => import('./pages/OAuthConsent'));
const OAuthConsentError = lazyPage(() => import('./pages/OAuthConsent').then((m) => ({ default: m.OAuthConsentError })));
const ClaudeConnections = lazyPage(() => import('./pages/settings/ClaudeConnections'));
const ChangePassword = lazyPage(() => import('./pages/ChangePassword'));
const SurveyPage = lazyPage(() => import('./pages/SurveyPage'));
const InstallPage = lazyPage(() => import('./pages/InstallPage'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const Tickets = lazyPage(() => import('./pages/tickets/Tickets'));
const TicketNew = lazyPage(() => import('./pages/tickets/TicketNew'));
const TicketRoute = lazyPage(() => import('./pages/tickets/TicketRoute'));
const TicketFormPage = lazyPage(() => import('./pages/tickets/form/TicketFormPage'));
const Projects = lazyPage(() => import('./pages/Projects'));
const ProjectNew = lazyPage(() => import('./pages/ProjectNew'));
const ProjectDetail = lazyPage(() => import('./pages/projects/ProjectDetail'));
const Contacts = lazyPage(() => import('./pages/Contacts'));
const ContactDetail = lazyPage(() => import('./pages/ContactDetail'));
const CompaniesList = lazyPage(() => import('./pages/companies/CompaniesList'));
const CompanyPage = lazyPage(() => import('./pages/companies/CompanyPage'));
const Assets = lazyPage(() => import('./pages/Assets'));
const AssetDetail = lazyPage(() => import('./pages/AssetDetail'));
const Licenses = lazyPage(() => import('./pages/assets/Licenses'));
const LicenseDetail = lazyPage(() => import('./pages/assets/LicenseDetail'));
const Contracts = lazyPage(() => import('./pages/assets/Contracts'));
const ContractDetail = lazyPage(() => import('./pages/assets/ContractDetail'));
const Reports = lazyPage(() => import('./pages/Reports'));
const Calendar = lazyPage(() => import('./pages/Calendar'));
const KnowledgeBase = lazyPage(() => import('./pages/KnowledgeBase'));
const ArticleEditor = lazyPage(() => import('./pages/ArticleEditor'));
const ArticleView = lazyPage(() => import('./pages/ArticleView'));
const PortalApp = lazyPage(() => import('./portal/PortalApp'));
const ClientPortalSettings = lazyPage(() => import('./pages/settings/ClientPortal'));
const NotFound = lazyPage(() => import('./pages/NotFound'));

// Settings hub + sections
const SettingsHome = lazyPage(() => import('./pages/settings/SettingsHome'));
const StartingValues = lazyPage(() => import('./pages/settings/StartingValues'));
const YourCompany = lazyPage(() => import('./pages/settings/YourCompany'));
const SettingsStatuses = lazyPage(() => import('./pages/settings/Statuses'));
const SettingsWorkHours = lazyPage(() => import('./pages/settings/WorkHours'));
const Workload = lazyPage(() => import('./pages/workload/Workload'));
const SettingsTeams = lazyPage(() => import('./pages/settings/Teams'));
const SettingsPreferences = lazyPage(() => import('./pages/settings/Preferences'));
const SettingsAbout = lazyPage(() => import('./pages/settings/About'));
const SettingsLayouts = lazyPage(() => import('./pages/settings/Layouts'));
const SettingsAssetCategories = lazyPage(() => import('./pages/settings/AssetCategories'));
const SettingsAssetAlerts = lazyPage(() => import('./pages/settings/AssetAlerts'));
const SettingsTimeTracking = lazyPage(() => import('./pages/settings/TimeTracking'));
const SettingsWorkTypes = lazyPage(() => import('./pages/settings/WorkTypes'));
const SettingsCannedResponses = lazyPage(() => import('./pages/settings/CannedResponses'));
const TicketRules = lazyPage(() => import('./pages/settings/TicketRules'));
const SettingsRecurringTickets = lazyPage(() => import('./pages/settings/RecurringTickets'));
const RecurringTicketEditor = lazyPage(() => import('./pages/settings/RecurringTicketEditor'));
const SettingsSingleSignOn = lazyPage(() => import('./pages/settings/SingleSignOn'));
const SettingsProjectTemplates = lazyPage(() => import('./pages/settings/ProjectTemplates'));
const ProjectTemplateEditor = lazyPage(() => import('./pages/settings/ProjectTemplateEditor'));
const Schedules = lazyPage(() => import('./pages/settings/Schedules'));
const SettingsImport = lazyPage(() => import('./pages/settings/Import'));
const SettingsExport = lazyPage(() => import('./pages/settings/Export'));
const SettingsNotifications = lazyPage(() => import('./pages/settings/Notifications'));
const SettingsEmailTemplates = lazyPage(() => import('./pages/settings/EmailTemplates'));
const WorkflowRules = lazyPage(() => import('./pages/settings/WorkflowRules'));
const WorkflowRuleEditor = lazyPage(() => import('./pages/settings/WorkflowRuleEditor'));
const CalendarIntegration = lazyPage(() => import('./pages/settings/CalendarIntegration'));
const CustomerHappiness = lazyPage(() => import('./pages/settings/CustomerHappiness'));
const SettingsChecklists = lazyPage(() => import('./pages/settings/checklists/Checklists'));
const ChecklistEditor = lazyPage(() => import('./pages/settings/checklists/ChecklistEditor'));
const BundleEditor = lazyPage(() => import('./pages/settings/checklists/BundleEditor'));
const SettingsMdms = lazyPage(() => import('./pages/settings/playbooks/Mdms'));

// Existing admin pages (reached via the Settings hub)
const AdminUsers = lazyPage(() => import('./pages/AdminUsers'));
const UserDetail = lazyPage(() => import('./pages/UserDetail'));
const AdminRoles = lazyPage(() => import('./pages/AdminRoles'));
const RoleEditor = lazyPage(() => import('./pages/RoleEditor'));
const AdminBlueprints = lazyPage(() => import('./pages/AdminBlueprints'));
const AdminApiKeys = lazyPage(() => import('./pages/AdminApiKeys'));
const SettingsDirectory = lazyPage(() => import('./pages/settings/Directory'));
const SettingsEmail = lazyPage(() => import('./pages/settings/Email'));
const SettingsSystemInfo = lazyPage(() => import('./pages/settings/SystemInfo'));
const EmailLog = lazyPage(() => import('./pages/settings/EmailLog'));
const AuditLog = lazyPage(() => import('./pages/settings/AuditLog'));

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
// Redirects keep the old address's params (/settings/forms/12 → /settings/checklists/12).
function ParamRedirect({ to }) {
  return <Navigate to={redirectTarget(to, useParams())} replace />;
}

const SETTINGS_COMPONENTS = {
  preferences: SettingsPreferences, about: SettingsAbout, 'your-company': YourCompany, 'client-portal': ClientPortalSettings,
  users: AdminUsers, 'user-detail': UserDetail, teams: SettingsTeams,
  roles: AdminRoles, 'role-new': RoleEditor, 'role-edit': RoleEditor, 'api-keys': AdminApiKeys,
  statuses: SettingsStatuses, 'custom-fields': SettingsLayouts, blueprints: AdminBlueprints,
  'workflow-rules': WorkflowRules, 'canned-responses': SettingsCannedResponses, 'ticket-rules': TicketRules,
  'recurring-tickets': SettingsRecurringTickets, 'recurring-ticket-new': RecurringTicketEditor, 'recurring-ticket-edit': RecurringTicketEditor,
  'workflow-rule-new': WorkflowRuleEditor, 'workflow-rule-edit': WorkflowRuleEditor,
  checklists: SettingsChecklists, 'checklist-new': ChecklistEditor, 'checklist-edit': ChecklistEditor, 'bundle-new': BundleEditor, 'bundle-edit': BundleEditor,
  mdms: SettingsMdms,
  'project-templates': SettingsProjectTemplates, 'project-template-new': ProjectTemplateEditor, 'project-template-edit': ProjectTemplateEditor,
  notifications: SettingsNotifications, 'customer-happiness': CustomerHappiness,
  'starting-values': StartingValues, 'work-hours': SettingsWorkHours,
  'time-tracking': SettingsTimeTracking, 'work-types': SettingsWorkTypes,
  'asset-categories': SettingsAssetCategories, 'asset-alerts': SettingsAssetAlerts,
  'single-sign-on': SettingsSingleSignOn, directory: SettingsDirectory,
  email: SettingsEmail, 'email-log': EmailLog, 'email-templates': SettingsEmailTemplates,
  calendar: CalendarIntegration, claude: ClaudeConnections, schedules: Schedules, import: SettingsImport,
  export: SettingsExport, 'audit-log': AuditLog, system: SettingsSystemInfo,
};

function settingsElement(id, access) {
  const Component = SETTINGS_COMPONENTS[id];
  const page = access.owner ? <OwnerOnly><Component /></OwnerOnly> : <Component />;
  return access.roles || access.permission
    ? <ProtectedRoute roles={access.roles} permission={access.permission}>{page}</ProtectedRoute>
    : page;
}

// Every page loads on demand (lazyPage), so the first screen doesn't carry
// the whole app, and the client portal never downloads the staff pages.
// Inside the staff frame, Layout and SettingsShell show their own fallback
// so the navigation stays put while a page loads; this one covers pages
// outside it (sign-in, the portal, surveys).
export default function App() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
        {/* Fully public — a contact reaches this via an emailed CSAT survey link, no PRISM login. */}
        <Route path="/survey/:token" element={<SurveyPage />} />
        {/* An install link (8d): public; the install key is the credential. */}
        <Route path="/install/:key" element={<InstallPage />} />
        {/* Claude asking to connect (MCP-O): sign in first, outside the frame. */}
        <Route path="/oauth/consent/error" element={<OAuthConsentError />} />
        <Route path="/oauth/consent/:id" element={<ProtectedRoute><OAuthConsent /></ProtectedRoute>} />
        {/* The client portal: /portal, and each company's at /portal/<slug>
            (contacts sign in there; its own session and frame). */}
        <Route path="/portal/*" element={<PortalApp />} />

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="/tickets" element={perm(<Tickets />, TICKETS_KEYS)} />
          <Route path="/tickets/new" element={perm(<TicketNew />, TICKETS_KEYS)} />
          <Route path="/tickets/:id" element={perm(<TicketRoute />, TICKETS_KEYS)} />
          <Route path="/tickets/:id/forms/:formId" element={perm(<TicketFormPage />, TICKETS_KEYS)} />

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

          <Route path="/workload" element={perm(<Workload />, ['workload.view'])} />
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
            {REDIRECTS.map(([from, to]) => <Route key={from} path={from} element={<ParamRedirect to={to} />} />)}
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
