// Settings › Service desk › Ticket rules (CS): the rules that hold for every
// company's tickets. Each is set here and nowhere else.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Switch from '../../components/Switch';
import SettingsPage, { SettingsPanel } from '../../components/settings/SettingsPage';
import { useAuth } from '../../context/AuthContext';

export default function TicketRules() {
  const { hasPermission } = useAuth();
  const canCategories = hasPermission('tickets.categories.manage');
  const canSystem = hasPermission('settings.manage_system');
  const [categoryRequired, setCategoryRequired] = useState(null);
  const [timeRequired, setTimeRequired] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ticket-categories', { params: { companyId: 'internal' } })
      .then(({ data }) => setCategoryRequired(!!data.categoryRequired))
      .catch((err) => setError(errMessage(err)));
    api.get('/settings')
      .then(({ data }) => setTimeRequired(data.settings['timeTracking.requireBeforeClose'] === 'true'))
      .catch(() => setTimeRequired(false));
  }, []);

  const save = async (call, apply) => {
    setBusy(true);
    setError('');
    try { await call(); apply(); } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  };

  return (
    <SettingsPage>
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <SettingsPanel title="New tickets">
        <div className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <span>
            <b className="block">Require a category on new tickets</b>
            <span className="text-navy-500">On the staff form, where the ticket&apos;s company has categories. The portal and the agent always ask when there are categories.</span>
          </span>
          <Switch checked={!!categoryRequired} disabled={busy || categoryRequired === null || !canCategories} label="Require a category on new tickets"
            onChange={(v) => save(() => api.put('/ticket-categories/settings', { categoryRequired: v }), () => setCategoryRequired(v))} />
        </div>
      </SettingsPanel>
      <SettingsPanel title="Closing tickets">
        <div className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <span>
            <b className="block">Require time before closing</b>
            <span className="text-navy-500">A ticket can&apos;t move to a closed status until at least one time entry is logged on it.</span>
          </span>
          <Switch checked={!!timeRequired} disabled={busy || timeRequired === null || !canSystem} label="Require time before closing"
            onChange={(v) => save(() => api.put('/settings', { settings: { 'timeTracking.requireBeforeClose': String(v) } }), () => setTimeRequired(v))} />
        </div>
      </SettingsPanel>
    </SettingsPage>
  );
}
