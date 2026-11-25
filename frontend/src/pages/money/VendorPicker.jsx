// Picks a vendor company (contractors and suppliers) by name.
import { useEffect, useState } from 'react';
import api from '../../api/api';

export default function VendorPicker({ value, onChange, label = 'Vendor', required = false }) {
  const [vendors, setVendors] = useState([]);
  useEffect(() => {
    api.get('/companies/vendors').then(({ data }) => setVendors(data.vendors)).catch(() => {});
  }, []);
  return (
    <label className="text-sm">{label}
      <select className="input mt-1" aria-label={label} required={required} value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{required ? 'Choose…' : 'None'}</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>
  );
}
