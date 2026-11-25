// What was paid to each contractor and supplier in a year, the 1099 list,
// and the bills still owed by age. Each downloads as CSV.
import { useEffect, useState } from 'react';
import api, { errMessage } from '../../api/api';
import Notice from '../../components/ui/Notice';
import Spinner from '../../components/Spinner';
import Tabs from '../../components/ui/Tabs';
import { download, usd } from './fmt';

const REPORTS = [{ id: 'paid', label: 'Paid per vendor' }, { id: '1099', label: '1099 totals' }, { id: 'open', label: 'Open bills' }];
const URL_OF = { paid: '/money/reports/paid-by-vendor', 1099: '/money/reports/1099', open: '/money/reports/open-bills' };
const AGES = [['current', 'Not yet due'], ['1-30', '1–30 days late'], ['31-60', '31–60'], ['61-90', '61–90'], ['90+', 'Over 90']];

export default function PayablesReports() {
  const [report, setReport] = useState('paid');
  const [year, setYear] = useState(new Date().getFullYear());
  // The data is kept with the report and year it answers, so switching
  // tabs never renders one report's rows with another's layout, and a slow
  // answer to an earlier choice is ignored.
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const params = report === 'open' ? {} : { year };
  const key = `${report}:${report === 'open' ? '' : year}`;
  const data = loaded && loaded.key === key ? loaded.data : null;
  useEffect(() => {
    let live = true;
    setError('');
    api.get(URL_OF[report], { params }).then((r) => { if (live) setLoaded({ key, data: r.data }); }).catch((err) => { if (live) setError(errMessage(err)); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const csv = () => download(api, URL_OF[report], `prism-${report}-${report === 'open' ? 'now' : year}.csv`, { ...params, format: 'csv' }).catch((err) => setError(errMessage(err)));

  return (
    <section aria-label="Reports" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs items={REPORTS} value={report} onChange={setReport} label="Reports" />
        {report !== 'open' && (
          <select className="input ml-auto w-auto" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map((n) => new Date().getFullYear() + 1 - n).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        <button type="button" className="btn-secondary" onClick={csv}>Download CSV</button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!data && !error && <Spinner />}
      {data && report === 'paid' && (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="paid-by-vendor">
            <thead><tr>{['Vendor', 'Gets a 1099', 'Bills', 'Billed', 'Paid'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.vendorCompanyId} className="border-t border-navy-100">
                  <td className="table-td font-medium">{v.vendor}</td><td className="table-td">{v.is1099 ? 'Yes' : ''}</td>
                  <td className="table-td num">{v.bills}</td><td className="table-td num">{usd(v.billed)}</td><td className="table-td num font-semibold">{usd(v.paid)}</td>
                </tr>
              ))}
              {!data.vendors.length && <tr><td className="table-td" colSpan={5}>Nothing billed or paid in {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {data && report === '1099' && (
        <div className="space-y-2">
          <p className="text-sm text-navy-500">Vendors marked “Gets a 1099” paid {usd(data.threshold)} or more in {year}. The threshold is in Settings › Money; check it with your CPA. PRISM keeps no tax IDs.</p>
          <div className="card overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="form-1099">
              <thead><tr>{['Vendor', `Paid in ${year}`].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
              <tbody>
                {data.vendors.map((v) => <tr key={v.vendorCompanyId} className="border-t border-navy-100"><td className="table-td font-medium">{v.vendor}</td><td className="table-td num">{usd(v.paid)}</td></tr>)}
                {!data.vendors.length && <tr><td className="table-td" colSpan={2}>No one reaches the threshold.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data && report === 'open' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {AGES.map(([k, l]) => <div key={k} className="card p-3"><div className="text-xs text-navy-500">{l}</div><div className="num font-semibold">{usd(data.totals[k])}</div></div>)}
            <div className="card p-3"><div className="text-xs text-navy-500">All owed</div><div className="num font-semibold">{usd(data.totals.all)}</div></div>
          </div>
          <div className="card overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="open-bills">
              <thead><tr>{['Vendor', 'Bill', 'Reference', 'Due', 'Days late', 'Amount'].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr key={b.id} className="border-t border-navy-100">
                    <td className="table-td font-medium">{b.vendor}</td><td className="table-td">{b.billNumber}</td><td className="table-td">{b.externalRef || '—'}</td>
                    <td className="table-td">{b.dueDate}</td><td className="table-td num">{b.daysOverdue > 0 ? b.daysOverdue : '—'}</td><td className="table-td num">{usd(b.total)}</td>
                  </tr>
                ))}
                {!data.bills.length && <tr><td className="table-td" colSpan={6}>Nothing owed.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
