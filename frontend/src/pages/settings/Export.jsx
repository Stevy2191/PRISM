import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMessage } from '../../api/api';
import { usePermission } from '../../context/AuthContext';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportRow({ title, desc, children, onExport, exporting, error }) {
  return (
    <div className="card space-y-3 p-5">
      <div>
        <p className="font-semibold text-navy-900">{title}</p>
        <p className="text-sm text-navy-500">{desc}</p>
      </div>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary" onClick={onExport} disabled={exporting}>
        {exporting ? 'Exporting…' : 'Export CSV'}
      </button>
    </div>
  );
}

export default function Export() {
  const canExport = usePermission('reports.export');
  const [ticketRange, setTicketRange] = useState({ startDate: '', endDate: '' });
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});

  const runExport = async (key, endpoint, params, filename) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: '' }));
    try {
      const res = await api.get(endpoint, { params, responseType: 'blob' });
      downloadBlob(res.data, filename);
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: errMessage(err) }));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Export</h1>
        <p className="text-sm text-navy-500">Download PRISM data as CSV.</p>
      </div>

      {!canExport && (
        <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
          You don't have permission to export reports (reports.export).
        </div>
      )}

      <ExportRow
        title="Contacts"
        desc="Every contact in your directory."
        onExport={() => runExport('contacts', '/reports/contacts/export', {}, 'prism-contacts.csv')}
        exporting={busy === 'contacts'}
        error={errors.contacts}
      />

      <ExportRow
        title="Tickets"
        desc="All tickets, optionally filtered to a creation-date range."
        onExport={() => runExport('tickets', '/reports/tickets/export', {
          startDate: ticketRange.startDate || undefined,
          endDate: ticketRange.endDate || undefined,
        }, 'prism-tickets.csv')}
        exporting={busy === 'tickets'}
        error={errors.tickets}
      >
        <div className="flex items-center gap-2">
          <input
            type="date" className="input h-9 text-sm"
            value={ticketRange.startDate}
            onChange={(e) => setTicketRange((r) => ({ ...r, startDate: e.target.value }))}
          />
          <span className="text-sm text-navy-400">to</span>
          <input
            type="date" className="input h-9 text-sm"
            value={ticketRange.endDate}
            onChange={(e) => setTicketRange((r) => ({ ...r, endDate: e.target.value }))}
          />
        </div>
      </ExportRow>

      <ExportRow
        title="Time entries"
        desc="Logged time across tickets and projects, with billing rates."
        onExport={() => runExport('time', '/reports/time-billing/export', {}, 'prism-time-entries.csv')}
        exporting={busy === 'time'}
        error={errors.time}
      />
    </div>
  );
}
