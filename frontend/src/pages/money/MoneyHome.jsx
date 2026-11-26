// Money (Phase 3): what customers owe (invoices, the billing run, agreements,
// payments — while Customer billing is on) and what the team owes and spends
// (bills, purchase orders, the shelf, expenses and their reports). Each tab
// shows by its own permission; the server checks them all again.
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/ui/PageHeader';
import Tabs from '../../components/ui/Tabs';
import Spinner from '../../components/Spinner';
import Bills from './Bills';
import PurchaseOrders from './PurchaseOrders';
import Stock from './Stock';
import Expenses from './Expenses';
import PayablesReports from './PayablesReports';
import Invoices from './Invoices';
import BillingRun from './BillingRun';
import Agreements from './Agreements';
import Payments from './Payments';
import useMoneyConfig from './useMoneyConfig';

const BILLING_VIEW = ['money.billing.view', 'money.billing.manage'];
const TABS = [
  { id: 'invoices', label: 'Invoices', keys: BILLING_VIEW, billing: true, Page: Invoices },
  { id: 'billing-run', label: 'Billing run', keys: ['money.billing.manage'], billing: true, Page: BillingRun },
  { id: 'agreements', label: 'Agreements', keys: BILLING_VIEW, billing: true, Page: Agreements },
  { id: 'payments', label: 'Payments', keys: BILLING_VIEW, billing: true, Page: Payments },
  { id: 'bills', label: 'Bills', keys: ['money.bills.manage'], Page: Bills },
  { id: 'purchase-orders', label: 'Purchase orders', keys: ['money.purchasing.manage'], Page: PurchaseOrders },
  { id: 'stock', label: 'Stock', keys: ['money.purchasing.manage'], Page: Stock },
  { id: 'expenses', label: 'Expenses', keys: ['money.bills.manage'], Page: Expenses },
  { id: 'reports', label: 'Reports', keys: ['money.bills.manage', 'money.books.view'], Page: PayablesReports },
];

export default function MoneyHome() {
  const { hasAnyPermission } = useAuth();
  const config = useMoneyConfig();
  const [params, setParams] = useSearchParams();
  if (!config) return <Spinner />;
  const tabs = TABS.filter((t) => hasAnyPermission(t.keys) && (!t.billing || config.customerBilling));
  const current = tabs.find((t) => t.id === params.get('tab')) || tabs[0];
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Money" sub="Invoices and payments, bills from contractors and suppliers, purchase orders, the shelf and expenses." />
      {!current ? <p className="mt-5 text-sm text-navy-500">Customer billing is off. An Owner can turn it on in Settings › Money.</p> : (
        <>
          <Tabs items={tabs} value={current.id} onChange={(id) => setParams({ tab: id })} label="Money sections" className="mt-5" />
          <div className="mt-5"><current.Page /></div>
        </>
      )}
    </div>
  );
}
