// A job's bills and purchase orders (Phase 3): what contractors and
// suppliers charged for this ticket or project. Amounts only for those with
// a money permission; adding needs money.bills.manage / money.purchasing.manage.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/api';
import { usePermission } from '../../context/AuthContext';
import StatusChip from '../ui/StatusChip';
import BillForm from '../../pages/money/BillForm';
import { BillActions } from '../../pages/money/Bills';
import PurchaseOrderForm from '../../pages/money/PurchaseOrderForm';
import { PoDetail } from '../../pages/money/PurchaseOrders';
import { usd } from '../../pages/money/fmt';

export default function BillsPanel({ kind, id }) {
  const canBills = usePermission('money.bills.manage');
  const canBuy = usePermission('money.purchasing.manage');
  const base = `/${kind === 'ticket' ? 'tickets' : 'projects'}/${id}`;
  const job = kind === 'ticket' ? { ticketId: id } : { projectId: id };
  const [bills, setBills] = useState([]);
  const [pos, setPos] = useState([]);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const load = () => {
    api.get(`${base}/bills`).then(({ data }) => setBills(data.bills)).catch(() => setBills([]));
    if (canBuy) api.get(`${base}/purchase-orders`).then(({ data }) => setPos(data.purchaseOrders)).catch(() => setPos([]));
  };
  useEffect(() => { load(); }, [base, canBuy]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bills.length && !pos.length && !canBills && !canBuy) return null;
  return (
    <section aria-labelledby={`${kind}-bills`} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${kind}-bills`} className="text-sm font-semibold">Bills and purchase orders</h3>
        <div className="flex gap-2">
          {canBills && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setAdding('bill')}>Add a bill</button>}
          {canBuy && <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setAdding('po')}>New purchase order</button>}
        </div>
      </div>
      <ul className="space-y-2 text-sm" data-testid={`${kind}-bills-list`}>
        {bills.map((b) => (
          <li key={`b${b.id}`} className="rounded-md border border-navy-100 p-2">
            <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === `b${b.id}` ? null : `b${b.id}`)}>
              <span><span className="font-medium">{b.vendor?.name}</span> · bill {b.billNumber}</span>
              <span className="flex items-center gap-2"><StatusChip tone={b.status === 'paid' ? 'good' : 'info'}>{b.status}</StatusChip>{b.total && <span className="num">{usd(b.total)}</span>}</span>
            </button>
            {open === `b${b.id}` && canBills && <div className="mt-2"><BillActions bill={b} onChanged={load} /></div>}
          </li>
        ))}
        {pos.map((po) => (
          <li key={`p${po.id}`} className="rounded-md border border-navy-100 p-2">
            <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === `p${po.id}` ? null : `p${po.id}`)}>
              <span><span className="font-medium">{po.number}</span> · {po.vendor?.name}</span>
              <StatusChip tone={po.status === 'received' ? 'good' : 'info'}>{po.status.replace('_', ' ')}</StatusChip>
            </button>
            {open === `p${po.id}` && <div className="mt-2"><PoDetail po={po} onChanged={load} /></div>}
          </li>
        ))}
        {!bills.length && !pos.length && <li className="text-navy-500">None yet. <Link className="underline" to="/money">Money</Link> has them all.</li>}
      </ul>
      {adding === 'bill' && <BillForm job={job} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}
      {adding === 'po' && <PurchaseOrderForm job={job} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}
    </section>
  );
}
