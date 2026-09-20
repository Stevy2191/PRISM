import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';
import Switch from '../../components/Switch';

// Fields differ per protocol. Keeping the descriptions here means the form is
// generated from one place rather than two near-identical JSX blocks.
const OIDC_FIELDS = [
  { key: 'issuerUrl', label: 'Issuer URL', placeholder: 'https://login.microsoftonline.com/<tenant>/v2.0', required: true,
    help: 'The base URL. PRISM reads /.well-known/openid-configuration from it.' },
  { key: 'clientId', label: 'Client ID', required: true },
  { key: 'scopes', label: 'Scopes', placeholder: 'openid profile email' },
  { key: 'groupsClaim', label: 'Groups claim', placeholder: 'groups',
    help: 'The claim carrying group membership, used for role mapping.' },
];

const SAML_FIELDS = [
  { key: 'entryPoint', label: 'Sign-on URL', placeholder: 'https://idp.example.com/sso/saml', required: true },
  { key: 'issuer', label: 'Service provider entity ID', placeholder: 'prism',
    help: 'Identifies PRISM to the identity provider. Defaults to the callback URL.' },
  { key: 'idpCert', label: 'IdP signing certificate', required: true, textarea: true,
    help: 'The X.509 certificate the identity provider signs assertions with.' },
  { key: 'groupsAttribute', label: 'Groups attribute', placeholder: 'groups' },
];

function fieldsFor(protocol) {
  return protocol === 'saml' ? SAML_FIELDS : OIDC_FIELDS;
}

function ProviderForm({ provider, roles, onClose, onSaved }) {
  const editing = !!provider;
  const [protocol, setProtocol] = useState(provider?.protocol || 'oidc');
  const [name, setName] = useState(provider?.name || '');
  const [slug, setSlug] = useState(provider?.slug || '');
  const [buttonLabel, setButtonLabel] = useState(provider?.buttonLabel || '');
  const [config, setConfig] = useState(provider?.config || {});
  const [secret, setSecret] = useState('');
  const [allowJit, setAllowJit] = useState(provider ? provider.allowJit : true);
  const [defaultRoleId, setDefaultRoleId] = useState(provider?.defaultRoleId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = (key, value) => setConfig((c) => ({ ...c, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name, buttonLabel: buttonLabel || null, config, allowJit,
        defaultRoleId: defaultRoleId || null,
      };
      // An empty secret box means "leave the stored value alone" — the server
      // never sends the real one back, so submitting blank must not wipe it.
      if (secret) payload[protocol === 'saml' ? 'spPrivateKey' : 'clientSecret'] = secret;

      if (editing) {
        await api.patch(`/sso-admin/providers/${provider.id}`, payload);
      } else {
        await api.post('/sso-admin/providers', { ...payload, slug, protocol });
      }
      onSaved();
    } catch (err) {
      setError(errMessage(err, 'Could not save provider'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${provider.name}` : 'Add identity provider'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-700">Display name</span>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-700">Protocol</span>
            <select
              className="input w-full"
              value={protocol}
              onChange={(e) => { setProtocol(e.target.value); setConfig({}); }}
              disabled={editing}
            >
              <option value="oidc">OpenID Connect</option>
              <option value="saml">SAML 2.0</option>
            </select>
            {editing && <span className="mt-1 block text-xs text-navy-400">Protocol cannot be changed after creation.</span>}
          </label>
        </div>

        {!editing && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-700">Slug</span>
            <input
              className="input w-full"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="entra"
              required
            />
            <span className="mt-1 block text-xs text-navy-400">
              Appears in the callback URL and cannot be changed later. Lowercase letters, numbers and hyphens.
            </span>
          </label>
        )}

        {editing && provider.callbackUrl && (
          <div className="rounded-md bg-navy-50 p-3 text-sm">
            <div className="mb-1 font-medium text-navy-700">
              {protocol === 'saml' ? 'Assertion consumer service (ACS) URL' : 'Redirect URI'}
            </div>
            <code className="break-all text-xs text-navy-600">{provider.callbackUrl}</code>
            <div className="mt-1 text-xs text-navy-400">Register this with your identity provider.</div>
            {protocol === 'saml' && (
              <div className="mt-2 text-xs">
                <a className="text-prism hover:underline" href={`/api/v1/sso/${provider.slug}/metadata`} target="_blank" rel="noreferrer">
                  Download service provider metadata
                </a>
              </div>
            )}
          </div>
        )}

        {fieldsFor(protocol).map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block font-medium text-navy-700">
              {f.label}{f.required && <span className="text-red-500"> *</span>}
            </span>
            {f.textarea ? (
              <textarea
                className="input w-full font-mono text-xs"
                rows={5}
                value={config[f.key] || ''}
                onChange={(e) => setField(f.key, e.target.value)}
                required={f.required}
              />
            ) : (
              <input
                className="input w-full"
                value={config[f.key] || ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder || ''}
                required={f.required}
              />
            )}
            {f.help && <span className="mt-1 block text-xs text-navy-400">{f.help}</span>}
          </label>
        ))}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy-700">
            {protocol === 'saml' ? 'Service provider private key' : 'Client secret'}
          </span>
          <input
            className="input w-full"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              (protocol === 'saml' ? provider?.hasSpPrivateKey : provider?.hasClientSecret)
                ? 'Stored — leave blank to keep unchanged'
                : ''
            }
            autoComplete="new-password"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-700">Default role</span>
            <select className="input w-full" value={defaultRoleId} onChange={(e) => setDefaultRoleId(e.target.value)}>
              <option value="">No role (no permissions)</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-navy-400">
              Applied when no group mapping matches.
            </span>
          </label>
          <div className="flex items-start gap-3 pt-6 text-sm">
            <Switch checked={allowJit} onChange={setAllowJit} />
            <div>
              <div className="font-medium text-navy-700">Create accounts automatically</div>
              <div className="text-xs text-navy-400">
                When off, only people who already have a linked PRISM account can sign in.
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add provider'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MappingsModal({ provider, roles, onClose }) {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimValue, setClaimValue] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/sso-admin/providers/${provider.id}/mappings`);
      setMappings(data.mappings);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [provider.id]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/sso-admin/providers/${provider.id}/mappings`, { claimValue, roleId });
      setClaimValue('');
      setRoleId('');
      load();
    } catch (err) {
      setError(errMessage(err, 'Could not add mapping'));
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/sso-admin/providers/${provider.id}/mappings/${id}`);
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  return (
    <Modal title={`Group mappings — ${provider.name}`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-navy-500">
        Map a group from {provider.name} to a PRISM role. Mappings are applied on every sign-in, so removing
        someone from a group there removes the role here the next time they log in.
      </p>

      {error && <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? <Spinner /> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wide text-navy-400">
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">PRISM role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {mappings.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-navy-400">No mappings yet.</td></tr>
            )}
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 font-mono text-xs text-navy-700">{m.claimValue}</td>
                <td className="px-3 py-2">{m.role?.name || m.roleId}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(m.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2 border-t border-navy-100 pt-4">
        <label className="block flex-1 text-sm" style={{ minWidth: '12rem' }}>
          <span className="mb-1 block font-medium text-navy-700">Group value</span>
          <input className="input w-full" value={claimValue} onChange={(e) => setClaimValue(e.target.value)} required />
        </label>
        <label className="block flex-1 text-sm" style={{ minWidth: '12rem' }}>
          <span className="mb-1 block font-medium text-navy-700">Role</span>
          <select className="input w-full" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
            <option value="">Select a role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary">Add</button>
      </form>
    </Modal>
  );
}

export default function SingleSignOn() {
  const [providers, setProviders] = useState([]);
  const [roles, setRoles] = useState([]);
  const [enforcement, setEnforcement] = useState({ ssoOnly: false, breakGlassAccounts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null); // provider object, or 'new'
  const [mappingFor, setMappingFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, r, e] = await Promise.all([
        api.get('/sso-admin/providers'),
        api.get('/roles'),
        api.get('/sso-admin/enforcement'),
      ]);
      setProviders(p.data.providers);
      setRoles(r.data.roles);
      setEnforcement(e.data);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (provider) => {
    try {
      await api.patch(`/sso-admin/providers/${provider.id}`, { isEnabled: !provider.isEnabled });
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  const removeProvider = async (provider) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${provider.name}? Users provisioned through it keep their accounts, but the link to this provider is removed.`)) return;
    try {
      const { data } = await api.delete(`/sso-admin/providers/${provider.id}`);
      setNotice(`Deleted ${provider.name}. ${data.unlinkedIdentities} linked identit${data.unlinkedIdentities === 1 ? 'y' : 'ies'} removed.`);
      load();
    } catch (err) {
      setError(errMessage(err));
    }
  };

  const toggleEnforcement = async (next) => {
    setError('');
    setNotice('');
    try {
      await api.put('/sso-admin/enforcement', { ssoOnly: next });
      load();
    } catch (err) {
      setError(errMessage(err, 'Could not change enforcement'));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link to="/settings" className="text-sm text-prism hover:underline">← Settings</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-900">Single Sign-On</h1>
        <p className="text-sm text-navy-500">
          Let people sign in with your organisation&apos;s identity provider over OpenID Connect or SAML 2.0.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-4 text-red-700">{error}</div>}
      {notice && <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
          <h2 className="font-semibold text-navy-900">Identity providers</h2>
          <button type="button" className="btn-secondary text-xs" onClick={() => setEditing('new')}>
            Add provider
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wide text-navy-400">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Protocol</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {providers.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-navy-400">
                No identity providers configured yet.
              </td></tr>
            )}
            {providers.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-navy-900">
                  {p.name}
                  <div className="font-mono text-xs font-normal text-navy-400">{p.slug}</div>
                </td>
                <td className="px-4 py-3 uppercase text-xs tracking-wide text-navy-500">
                  {p.protocol === 'saml' ? 'SAML 2.0' : 'OIDC'}
                </td>
                <td className="px-4 py-3">
                  <Switch checked={p.isEnabled} onChange={() => toggleEnabled(p)} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="mr-3 text-xs text-prism hover:underline" onClick={() => setMappingFor(p)}>
                    Group mappings
                  </button>
                  <button type="button" className="mr-3 text-xs text-prism hover:underline" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeProvider(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-navy-900">Require single sign-on</h2>
            <p className="mt-1 text-sm text-navy-500">
              Turns off password and directory sign-in for everyone except break-glass accounts.
            </p>
          </div>
          <Switch checked={enforcement.ssoOnly} onChange={toggleEnforcement} />
        </div>

        <div className="mt-4 border-t border-navy-100 pt-4">
          <h3 className="text-sm font-medium text-navy-700">Break-glass accounts</h3>
          <p className="mt-1 text-xs text-navy-400">
            Local accounts that can still sign in with a password while SSO is required. Without at least one,
            a problem with your identity provider would lock everybody out. Designate them on a user&apos;s
            profile under <Link className="text-prism hover:underline" to="/admin/users">Users</Link>.
          </p>
          {enforcement.breakGlassAccounts.length === 0 ? (
            <p className="mt-2 text-sm text-amber-700">None designated.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-navy-700">
              {enforcement.breakGlassAccounts.map((u) => (
                <li key={u.id}>
                  {u.displayName} <span className="font-mono text-xs text-navy-400">{u.username}</span>
                  {!u.isActive && <span className="ml-2 text-xs text-amber-700">(inactive)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <ProviderForm
          provider={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {mappingFor && (
        <MappingsModal provider={mappingFor} roles={roles} onClose={() => { setMappingFor(null); load(); }} />
      )}
    </div>
  );
}
