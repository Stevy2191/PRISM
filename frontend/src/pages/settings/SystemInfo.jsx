// The upload limit and what this instance runs on, out of the old General
// Settings. The time zone lives on Company profile only.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import SettingsPage, { SettingsPanel, SettingsRow } from '../../components/settings/SettingsPage';
import SaveBar, { isDirty } from '../../components/settings/SaveBar';

function Info({ label, children }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-2.5 text-sm">
      <span className="text-navy-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-navy-800">{children ?? '—'}</span>
    </div>
  );
}

export default function SystemInfo() {
  const [config, setConfig] = useState(null);
  const [size, setSize] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setConfig(data.config);
      const v = data.settings['system.maxAttachmentSizeMB'] || '25';
      setSize(v);
      setSnapshot(v);
    }).catch((err) => setError(errMessage(err)));
  }, []);

  if (!config) return error ? <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div> : <Spinner />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', { settings: { 'system.maxAttachmentSizeMB': String(size) } });
      setSnapshot(size);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage>
      {error && <div role="alert" className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      <form onSubmit={save} className="space-y-5">
        <SettingsPanel title="Uploads">
          <SettingsRow label="Max attachment size (MB)" htmlFor="max-upload" help="For ticket and project files. The hard ceiling is 100 MB.">
            <input id="max-upload" type="number" min="1" max="100" className="input max-w-[8rem]" value={size}
              onChange={(e) => { setSaved(false); setSize(e.target.value); }} />
          </SettingsRow>
        </SettingsPanel>
        <SaveBar dirty={isDirty(size, snapshot)} saving={saving} saved={saved} />
      </form>
      <SettingsPanel title="Database">
        <Info label="Host">{config.database.host}</Info>
        <Info label="Port">{config.database.port}</Info>
        <Info label="Name">{config.database.name}</Info>
        <Info label="User">{config.database.user}</Info>
      </SettingsPanel>
      <SettingsPanel title="Application">
        <Info label="Environment">{config.app.nodeEnv}</Info>
        <Info label="Session secret">{config.app.sessionSecretSet ? 'set' : 'not set'}</Info>
      </SettingsPanel>
    </SettingsPage>
  );
}
