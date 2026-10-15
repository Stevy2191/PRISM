// Settings → Canned responses (5b). Everyone manages their own personal
// responses here; people with tickets.canned.manage also manage the shared
// (team and everyone) ones. The server decides what each person may see and
// change — this page only mirrors it.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import { usePermission } from '../../context/AuthContext';

const EMPTY = { id: null, title: '', body: '', visibility: 'personal', teamId: '' };
const VISIBILITY_LABEL = { personal: 'Only me', team: 'Team', everyone: 'Everyone' };

export default function CannedResponses() {
  const canManage = usePermission('tickets.canned.manage');
  const [responses, setResponses] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/canned-responses', { params: canManage ? { manage: '1' } : {} })
      .then(({ data }) => { setResponses(data.responses); setPlaceholders(data.placeholders || []); })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [canManage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (canManage) api.get('/teams').then(({ data }) => setTeams(data.teams || [])).catch(() => {});
  }, [canManage]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        title: form.title, body: form.body, visibility: form.visibility, teamId: form.visibility === 'team' ? form.teamId || null : null,
      };
      if (form.id) await api.patch(`/canned-responses/${form.id}`, body);
      else await api.post('/canned-responses', body);
      setForm(null);
      load();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete "${r.title}"?`)) return;
    try { await api.delete(`/canned-responses/${r.id}`); load(); } catch (err) { alert(errMessage(err)); }
  };

  if (loading) return <Spinner />;

  return (
    <SettingsPage description="Reusable replies you can insert into the reply box. Placeholders like {{contact.firstName}} are filled in from the ticket.">
      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}

      {!form && (
        <div>
          <button type="button" className="btn-primary" onClick={() => setForm({ ...EMPTY })}>New canned response</button>
        </div>
      )}

      {form && (
        <form onSubmit={save} className="card space-y-3 p-5" data-testid="canned-form">
          <div>
            <label className="label" htmlFor="canned-title">Title</label>
            <input id="canned-title" className="input" maxLength={200} value={form.title} onChange={set('title')} required />
          </div>
          <div>
            <label className="label" htmlFor="canned-body">Text</label>
            <textarea id="canned-body" className="input min-h-[140px] resize-y" maxLength={10000} value={form.body} onChange={set('body')} required />
            {placeholders.length > 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Placeholders: {placeholders.map((p) => <code key={p} className="mr-2">{`{{${p}}}`}</code>)}
              </p>
            )}
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="label" htmlFor="canned-visibility">Who can use it</label>
                <select id="canned-visibility" className="input" value={form.visibility} onChange={set('visibility')}>
                  <option value="personal">Only me</option>
                  <option value="team">A team</option>
                  <option value="everyone">Everyone</option>
                </select>
              </div>
              {form.visibility === 'team' && (
                <div>
                  <label className="label" htmlFor="canned-team">Team</label>
                  <select id="canned-team" className="input" value={form.teamId || ''} onChange={set('teamId')} required>
                    <option value="">Choose a team…</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {responses.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.title}</p>
              <p className="eyebrow mt-0.5">{VISIBILITY_LABEL[r.visibility]}{r.team ? `: ${r.team.name}` : ''}</p>
              <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.body}</p>
            </div>
            <div className="flex flex-shrink-0 gap-3 text-xs">
              <button
                type="button"
                className="hover:underline"
                style={{ color: 'var(--color-accent)' }}
                onClick={() => setForm({ id: r.id, title: r.title, body: r.body, visibility: r.visibility, teamId: r.teamId || '' })}
              >
                edit
              </button>
              <button type="button" className="text-red-500 hover:underline" onClick={() => remove(r)}>delete</button>
            </div>
          </div>
        ))}
        {responses.length === 0 && <div className="p-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>No canned responses yet.</div>}
      </div>
    </SettingsPage>
  );
}
