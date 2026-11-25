// Money (Phase 3, step 2): what the team owes and spends — contractors' and
// suppliers' bills, purchase orders, the shelf, expenses and their reports.
// Each tab shows by its own permission; the server checks them all again.
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import Tabs from '../../components/ui/Tabs';
import Bills from './Bills';
import PurchaseOrders from './PurchaseOrders';
import Stock from './Stock';
import Expenses from './Expenses';
import PayablesReports from './PayablesReports';

const TABS = [
  { id: 'bills', label: 'Bills', keys: ['money.bills.manage'], Page: Bills },
  { id: 'purchase-orders', label: 'Purchase orders', keys: ['money.purchasing.manage'], Page: PurchaseOrders },
  { id: 'stock', label: 'Stock', keys: ['money.purchasing.manage'], Page: Stock },
  { id: 'expenses', label: 'Expenses', keys: ['money.bills.manage'], Page: Expenses },
  { id: 'reports', label: 'Reports', keys: ['money.bills.manage', 'money.books.view'], Page: PayablesReports },
];

export default function MoneyHome() {
  const { hasAnyPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => hasAnyPermission(t.keys));
  const current = tabs.find((t) => t.id === params.get('tab')) || tabs[0];
  if (!current) return null;
  const { Page } = current;
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Money" sub="Bills from contractors and suppliers, purchase orders, the shelf and expenses." />
      <Tabs items={tabs} value={current.id} onChange={(id) => setParams({ tab: id })} label="Money sections"className="mt-5" />
      <div className="mt-5"><Page /></div>
    </div>
  );
}
