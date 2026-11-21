import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage from '../../components/settings/SettingsPage';
import Notice from '../../components/ui/Notice';
import { fmtDateTime } from '../../utils/formatDate';

// Settings › Claude (MCP-O): an Owner lets people connect Claude to PRISM.
// Each person signs in to PRISM and approves; Claude then acts as them, with
// their permissions. Off until turned on here.

function Copyable({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(value).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  });
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-md bg-navy-50 px-3 py-1.5 text-xs text-navy-700" aria-label="Connector URL">{value}</code>
      <button type="button" onClick={copy} className="btn-secondary text-xs">{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}

export default function ClaudeConnections() {
  const [settings, setSettings] = useState(null);
  const [domains, setDomains] = useState('');
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConnections = () => api.get('/oauth/connections').then(({ data }) => setConnections(data.connections));

  useEffect(() => {
    Promise.all([api.get('/oauth/settings'), loadConnections()])
      .then(([{ data }]) => { setSettings(data); setDomains(data.allowedDomains.join(', ')); })
      .catch((err) => setError(errMessage(err)));
  }, []);

  const save = async (changes) => {
    setSaving(true); setError('');
    try {
      const { data } = await api.put('/oauth/settings', changes);
      setSettings(data);
      setDomains(data.allowedDomains.join(', '));
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (c) => {
    if (!window.confirm(`Disconnect ${c.client?.name || 'this app'} for ${c.user?.displayName || c.user?.username}? They can connect again.`)) return;
    try {
      await api.delete(`/oauth/connections/${c.id}`);
      await loadConnections();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  if (!settings) return error ? <Notice tone="bad">{error}</Notice> : <Spinner />;

  return (
    <SettingsPage description="Let people connect Claude (claude.ai, the Claude apps, Claude Desktop and Claude Code) to PRISM. Each person signs in to PRISM and approves; Claude then acts as them, with exactly their permissions.">
      {error && <Notice tone="bad">{error}</Notice>}
      {!settings.httpsReady && (
        <Notice>
          Claude only connects over HTTPS. Set <code>PUBLIC_APP_URL</code> in PRISM&apos;s <code>.env</code> to its
          https:// address and restart PRISM, then turn this on.
        </Notice>
      )}

      <div className="card space-y-4 p-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.enabled}
            disabled={saving || (!settings.enabled && !settings.httpsReady)}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <span>
            <span className="font-medium text-navy-900">Let people connect Claude</span>
            <span className="block text-sm text-navy-500">Turning this off disconnects everyone at once.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.allowWrites}
            disabled={saving}
            onChange={(e) => save({ allowWrites: e.target.checked })}
          />
          <span>
            <span className="font-medium text-navy-900">Claude can make changes</span>
            <span className="block text-sm text-navy-500">
              Create and update tickets, add notes and replies, log time. Off: Claude can only look.
              Replies Claude sends are emailed to customers like anyone&apos;s.
            </span>
          </span>
        </label>
        {saved && <p className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>Saved</p>}
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="font-semibold text-navy-900">Connect Claude</h2>
        <Copyable value={settings.connectorUrl} />
        <ol className="list-inside list-decimal space-y-1 text-sm text-navy-600">
          <li>In Claude, open Settings › Connectors and choose <span className="font-medium">Add custom connector</span>.</li>
          <li>Name it PRISM and paste the URL above. Leave the OAuth settings as they are.</li>
          <li>Click <span className="font-medium">Connect</span>, sign in to PRISM, and choose <span className="font-medium">Allow</span>.</li>
        </ol>
        <p className="text-xs text-navy-500">On a Team or Enterprise plan, an owner adds the connector once; each person then clicks Connect.</p>
      </div>

      <div className="card space-y-2 p-5">
        <label htmlFor="claude-domains" className="label">Apps allowed to connect (their domains)</label>
        <div className="flex gap-2">
          <input id="claude-domains" className="input flex-1" value={domains} onChange={(e) => setDomains(e.target.value)} />
          <button
            type="button"
            className="btn-secondary"
            disabled={saving}
            onClick={() => save({ allowedDomains: domains.split(/[\s,]+/).filter(Boolean) })}
          >
            Save
          </button>
        </div>
        <p className="text-xs text-navy-500">
          An app may only send people back to these domains after they sign in. claude.ai and claude.com are Claude;
          localhost lets Claude Code and Claude Desktop connect from a person&apos;s own computer.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Connections</h2>
        {connections.length === 0 ? (
          <p className="text-sm text-navy-500">No one has connected yet.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-navy-500">
                <th className="py-1">Person</th><th>App</th><th>Connected</th><th>Last used</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2">{c.user?.displayName || c.user?.username}</td>
                  <td>{c.client?.name}</td>
                  <td>{fmtDateTime(c.createdAt)}</td>
                  <td>{fmtDateTime(c.lastUsedAt, 'Not yet')}</td>
                  <td className="text-right">
                    <button type="button" className="btn-secondary text-xs" onClick={() => revoke(c)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </SettingsPage>
  );
}
