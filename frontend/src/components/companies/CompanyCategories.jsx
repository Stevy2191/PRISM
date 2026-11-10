// A company's Categories tab (sub-project 9): its own ticket category tree,
// never shared with another company. The same editor as Settings → Ticket
// categories, for this company.
import { usePermission } from '../../context/AuthContext';
import Notice from '../ui/Notice';
import { CategoryEditor } from '../../pages/settings/TicketCategories';

export default function CompanyCategories({ company }) {
  const canManage = usePermission('tickets.categories.manage');
  if (!canManage) return <Notice tone="info">You need the Manage ticket categories permission to change {company.name}&apos;s categories.</Notice>;
  return (
    <div className="space-y-5">
      <CategoryEditor key={company.id} companyId={company.id} companyName={company.name} />
    </div>
  );
}
