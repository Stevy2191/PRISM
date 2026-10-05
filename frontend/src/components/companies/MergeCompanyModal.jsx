import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Modal from '../Modal';

const COUNT_LABELS = {
  contacts: 'Contacts', departments: 'Departments', sites: 'Sites', tickets: 'Tickets', projects: 'Projects',
  assets: 'Assets', licenses: 'Licenses', contracts: 'Contracts', vendorAssets: 'Assets bought from it',
  vendorLicenses: 'Licenses bought from it', vendorContracts: 'Contracts with it', vendorMaterials: 'Project materials bought from it',
  domains: 'Email domains', userAccess: 'User access grants', roleAccess: 'Role access grants',
};

// "Merge into…": pick the company to keep, see what will move, confirm.
// The merged-away company is deleted (spec: Merge).
export default function MergeCompanyModal({ company, onClose, onMerged }) {
  const [targets, setTargets] = useState([]);
  const [intoId, setIntoId] = useState('');
  const [counts, setCounts] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies', { params: { status: 'active', limit: 200 } })
      .then(({ data }) => setTargets(data.companies.filter((c) => c.id !== company.id)))
      .catch((err) => setError(errMessage(err)));
  }, [company.id]);

  const preview = async (id) => {
    setIntoId(id);
    setCounts(null);
    setConfirmed(false);
    setError('');
    if (!id) return;
    try {
      const { data } = await api.post(`/companies/${company.id}/merge`, { intoCompanyId: Number(id) }, { params: { preview: true } });
      setCounts(data.counts);
    } catch (err) {
      setError(errMessage(err));
    }
  };

  const merge = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/companies/${company.id}/merge`, { intoCompanyId: Number(intoId) });
      onMerged(data.company);
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  const target = targets.find((t) => String(t.id) === String(intoId));
  const moving = counts ? Object.entries(counts).filter(([, n]) => n > 0) : [];
  return (
    <Modal title={`Merge ${company.name}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="label" htmlFor="merge-into">Merge into</label>
          <select id="merge-into" className="input" value={intoId} onChange={(e) => preview(e.target.value)}>
            <option value="">Choose the company to keep…</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {counts && (
          <div className="card p-3 text-sm">
            {moving.length ? (
              <table className="w-full">
                <tbody>
                  {moving.map(([key, n]) => (
                    <tr key={key}><td className="py-0.5">{COUNT_LABELS[key] || key}</td><td className="py-0.5 text-right font-mono">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p>Nothing references {company.name}.</p>}
          </div>
        )}
        {counts && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I understand {company.name} will be deleted and this can&apos;t be undone.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" disabled={!counts || !confirmed || busy} onClick={merge}>
            {busy ? 'Merging…' : `Merge into ${target ? target.name : '…'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
