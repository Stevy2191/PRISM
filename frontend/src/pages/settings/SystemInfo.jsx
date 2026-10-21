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

const SCAN_STATE = {
  ok: { label: 'Connected', color: 'var(--color-success)' },
  unreachable: { label: 'Unreachable', color: 'var(--color-danger)' },
  off: { label: 'Off', color: 'var(--color-text-muted)' },
};

function AttachmentScanning() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const { data } = await api.get('/settings/virus-scan/status');
      setStatus(data);
    } catch {
      setStatus({ state: 'unreachable', version: null, signatureDate: null });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => { check(); }, []);

  const st = status && SCAN_STATE[status.state];
  const test = (
    <button type="button" className="btn-secondary" onClick={check} disabled={checking}>
      {checking ? 'Checking…' : 'Test'}
    </button>
  );
  return (
    <SettingsPanel title="Attachment scanning" description="Every uploaded and emailed file is checked for viruses before it is stored." actions={test}>
      <div className="flex justify-between gap-4 px-5 py-2.5 text-sm" data-testid="scan-status">
        <span className="text-navy-500">Scanner</span>
        <span className="font-medium" style={{ color: st ? st.color : 'var(--color-text-muted)' }}>{st ? st.label : 'Checking…'}</span>
      </div>
      {status?.state === 'ok' && <Info label="Version">{status.version}</Info>}
      {status?.state === 'ok' && <Info label="Signatures updated">{status.signatureDate ? new Date(status.signatureDate).toLocaleString() : null}</Info>}
      {status?.state === 'unreachable' && (
        <p className="px-5 py-2.5 text-sm text-navy-500">
          Files can't be uploaded or received by email until the scanner is back. Check that the ClamAV service is running.
        </p>
      )}
      {status?.state === 'off' && (
        <p className="px-5 py-2.5 text-sm text-navy-500">Scanning is switched off (CLAMAV_ENABLED=false). Files are stored without being checked.</p>
      )}
    </SettingsPanel>
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
      <AttachmentScanning />
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
