import { useEffect, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import api, { errMessage } from '../../api/api';
import { useSettings } from '../../context/SettingsContext';

const fieldStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)' };

const EMPTY_FORM = {
  host: '', port: 389, baseDN: '', bindDN: '', bindPassword: '',
  useSSL: false,
  usernameAttr: 'sAMAccountName', emailAttr: 'mail', displayNameAttr: 'displayName',
  firstNameAttr: 'givenName', lastNameAttr: 'sn', phoneAttr: 'telephoneNumber',
  searchFilter: '(objectClass=user)', pageSize: 1000, timeout: 10, followReferrals: false,
};

function relativeTime(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export default function LdapSection() {
  const { refresh: refreshPublicSettings } = useSettings();
  const [form, setForm] = useState(EMPTY_FORM);
  const [bindPasswordSet, setBindPasswordSet] = useState(false);
  const [status, setStatus] = useState({ source: 'env', configured: false, lastTestAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = () => {
    api.get('/settings/ldap')
      .then(({ data }) => {
        setForm({
          host: data.host, port: data.port, baseDN: data.baseDN, bindDN: data.bindDN, bindPassword: '',
          useSSL: data.useSSL,
          usernameAttr: data.usernameAttr, emailAttr: data.emailAttr, displayNameAttr: data.displayNameAttr,
          firstNameAttr: data.firstNameAttr, lastNameAttr: data.lastNameAttr, phoneAttr: data.phoneAttr,
          searchFilter: data.searchFilter, pageSize: data.pageSize, timeout: data.timeout,
          followReferrals: data.followReferrals,
        });
        setBindPasswordSet(data.bindPassword === '***');
        setStatus({ source: data.source, configured: data.configured, lastTestAt: data.lastTestAt });
      })
      .catch((err) => setError(errMessage(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const toggleSSL = (e) => {
    const useSSL = e.target.checked;
    setForm((f) => ({
      ...f,
      useSSL,
      // Only auto-switch the port if it's still at a standard default —
      // preserves a custom port the admin already typed in.
      port: (Number(f.port) === 389 || Number(f.port) === 636) ? (useSSL ? 636 : 389) : f.port,
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings/ldap', form);
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2500);
      load();
      refreshPublicSettings();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/settings/ldap/test', form);
      setTestResult(data);
      if (data.success) {
        setStatus((s) => ({ ...s, lastTestAt: new Date().toISOString() }));
        refreshPublicSettings();
      }
    } catch (err) {
      setTestResult({ success: false, message: errMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const badge = testResult
    ? (testResult.success ? { label: 'Connected', cls: 'bg-green-100 text-green-800' } : { label: 'Connection failed', cls: 'bg-red-100 text-red-700' })
    : !status.configured
      ? { label: 'Not configured', cls: 'bg-navy-100 text-navy-500' }
      : status.lastTestAt
        ? { label: 'Connected', cls: 'bg-green-100 text-green-800' }
        : { label: 'Not tested yet', cls: 'bg-amber-100 text-amber-800' };

  if (loading) return <div className="card p-5 text-sm text-navy-400">Loading Active Directory settings…</div>;

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-navy-900">Active Directory / LDAP</h2>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
          </div>
          <p className="mt-1 text-xs text-navy-400">
            {status.source === 'database'
              ? 'Using the configuration below.'
              : 'No configuration saved yet — falling back to server .env variables, if any.'}
            {status.lastTestAt && ` Last successful test: ${relativeTime(status.lastTestAt)}.`}
          </p>
        </div>
        <button type="button" className="btn-secondary flex-shrink-0 text-sm" onClick={test} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {testResult && (
        <div className={`rounded-md p-3 text-sm ${testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {testResult.message}
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          {/* Left column */}
          <div className="space-y-4">
            <Field label="Server hostname or IP">
              <input className="input" style={fieldStyle} value={form.host} onChange={set('host')} placeholder="ldap.company.com" />
            </Field>
            <Field label="Port">
              <input type="number" className="input max-w-[8rem]" style={fieldStyle} value={form.port} onChange={set('port')} />
            </Field>
            <Field label="Base DN">
              <input className="input" style={fieldStyle} value={form.baseDN} onChange={set('baseDN')} placeholder="DC=company,DC=com" />
            </Field>
            <Field label="Bind DN">
              <input className="input" style={fieldStyle} value={form.bindDN} onChange={set('bindDN')} placeholder="CN=ldapuser,OU=Service Accounts,DC=company,DC=com" />
            </Field>
            <Field label="Bind password">
              <input
                type="password" className="input" style={fieldStyle} value={form.bindPassword} onChange={set('bindPassword')}
                placeholder={bindPasswordSet ? '••••••••' : 'Not set'} autoComplete="new-password"
              />
            </Field>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <label className="flex h-9 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.useSSL} onChange={toggleSSL} className="h-4 w-4 rounded border-navy-300 text-prism" />
              <span className="text-sm text-navy-700">Use SSL/TLS (ldaps://)</span>
            </label>
            <Field label="Username attribute">
              <input className="input" style={fieldStyle} value={form.usernameAttr} onChange={set('usernameAttr')} />
            </Field>
            <Field label="Email attribute">
              <input className="input" style={fieldStyle} value={form.emailAttr} onChange={set('emailAttr')} />
            </Field>
            <Field label="Display name attribute">
              <input className="input" style={fieldStyle} value={form.displayNameAttr} onChange={set('displayNameAttr')} />
            </Field>
            <Field label="First name attribute">
              <input className="input" style={fieldStyle} value={form.firstNameAttr} onChange={set('firstNameAttr')} />
            </Field>
            <Field label="Last name attribute">
              <input className="input" style={fieldStyle} value={form.lastNameAttr} onChange={set('lastNameAttr')} />
            </Field>
            <Field label="Phone attribute">
              <input className="input" style={fieldStyle} value={form.phoneAttr} onChange={set('phoneAttr')} />
            </Field>
          </div>
        </div>

        <div className="border-t border-navy-100 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-navy-600 hover:text-navy-900"
          >
            {showAdvanced ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            Advanced
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
              <Field label="Search filter">
                <input className="input" style={fieldStyle} value={form.searchFilter} onChange={set('searchFilter')} placeholder="(objectClass=user)" />
              </Field>
              <Field label="Pagination size">
                <input type="number" className="input" style={fieldStyle} value={form.pageSize} onChange={set('pageSize')} />
              </Field>
              <Field label="Connection timeout (seconds)">
                <input type="number" className="input" style={fieldStyle} value={form.timeout} onChange={set('timeout')} />
              </Field>
              <label className="flex h-9 cursor-pointer items-center gap-2 self-end">
                <input type="checkbox" checked={form.followReferrals} onChange={set('followReferrals')} className="h-4 w-4 rounded border-navy-300 text-prism" />
                <span className="text-sm text-navy-700">Follow referrals</span>
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-navy-100 pt-4">
          {savedAt && <span className="text-sm text-green-600">Saved</span>}
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button>
        </div>
      </form>
    </div>
  );
}
