import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconUsers, IconTicket, IconBox } from '@tabler/icons-react';
import api from '../../api/api';
import ImportContactsModal from '../../components/ImportContactsModal';

function ImportCard({ icon: Icon, title, desc, action, comingSoon }) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-navy-100 text-navy-500">
          <Icon size={20} stroke={1.5} />
        </div>
        <p className="font-semibold text-navy-900">{title}</p>
      </div>
      <p className="flex-1 text-sm text-navy-500">{desc}</p>
      {comingSoon ? (
        <span className="badge w-fit bg-amber-100 text-amber-800">Planned for a future update</span>
      ) : action}
    </div>
  );
}

export default function Import() {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data.departments)).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/settings" className="text-sm text-prism hover:underline">← Back to Settings</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Import</h1>
        <p className="text-sm text-navy-500">Bring records into PRISM from a CSV file.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ImportCard
          icon={IconUsers}
          title="Contacts"
          desc="Import customers from a CSV export of your existing directory or CRM."
          action={<button className="btn-primary" onClick={() => setShowImport(true)}>Import contacts</button>}
        />
        <ImportCard
          icon={IconTicket}
          title="Tickets"
          desc="Bulk-import historical tickets from another helpdesk system."
          comingSoon
        />
        <ImportCard
          icon={IconBox}
          title="Assets"
          desc="Import hardware/software assets to link to tickets and contacts."
          comingSoon
        />
      </div>

      {showImport && (
        <ImportContactsModal
          departments={departments}
          onClose={() => setShowImport(false)}
          onImported={() => navigate('/contacts')}
        />
      )}
    </div>
  );
}
