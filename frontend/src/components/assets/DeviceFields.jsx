// Management and cellular fields of a device (PB): managed yes/no and which
// MDM (from Settings › MDMs), the device's MDM ID, and cellular with IMEI,
// phone number and carrier (a vendor company). Used by the asset form and by
// the ticket's Add device dialog. `value` holds the asset fields; onChange
// receives a partial update.
import { useEffect, useState } from 'react';
import api from '../../api/api';
import Field from '../ui/Field';
import VendorPicker from '../companies/VendorPicker';

const inputClass = 'h-10 w-full rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900';

export function YesNo({ value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-navy-100 bg-surface">
      {[['Yes', true], ['No', false]].map(([text, v]) => (
        <button
          key={text}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`h-8 px-3 text-sm ${value === v ? 'font-semibold' : 'font-medium text-navy-500'}`}
          style={value === v ? { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent-ink, var(--color-accent))' } : undefined}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function useMdms() {
  const [mdms, setMdms] = useState([]);
  useEffect(() => {
    api.get('/mdms').then(({ data }) => setMdms(data.mdms)).catch(() => setMdms([]));
  }, []);
  return mdms;
}

export default function DeviceFields({ value, onChange, mdms, columns = 2 }) {
  const grid = columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  const choosable = mdms.filter((m) => m.isActive || m.id === value.mdmId);
  return (
    <div className="flex flex-col gap-4">
      <div className={`grid grid-cols-1 gap-3.5 ${grid}`}>
        <Field label="Managed by an MDM?">
          <YesNo label="Managed" value={!!value.isManaged} onChange={(v) => onChange({ isManaged: v, ...(v ? {} : { mdmId: null, mdmDeviceId: '' }) })} />
        </Field>
        {value.isManaged && (
          <Field label="MDM" hint={mdms.length ? undefined : 'Add your MDMs in Settings › MDMs.'}>
            <select className={inputClass} value={value.mdmId || ''} onChange={(e) => onChange({ mdmId: e.target.value ? Number(e.target.value) : null })} data-testid="mdm-select">
              <option value="">Choose…</option>
              {choosable.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isActive ? '' : ' (retired)'}</option>)}
            </select>
          </Field>
        )}
        {value.isManaged && (
          <Field label="MDM device ID" hint="Optional">
            <input className={inputClass} value={value.mdmDeviceId || ''} onChange={(e) => onChange({ mdmDeviceId: e.target.value })} />
          </Field>
        )}
      </div>
      <div className={`grid grid-cols-1 gap-3.5 border-t border-navy-100 pt-3.5 ${grid}`}>
        <Field label="Has cellular service?" hint="Any device can have a line: phones, tablets, laptops with a SIM.">
          <YesNo label="Cellular" value={!!value.hasCellular} onChange={(v) => onChange({ hasCellular: v })} />
        </Field>
        {value.hasCellular && (
          <Field label="IMEI">
            <input className={`${inputClass} num`} inputMode="numeric" value={value.imei || ''} onChange={(e) => onChange({ imei: e.target.value })} />
          </Field>
        )}
        {value.hasCellular && (
          <Field label="Phone number" hint="Leave empty for a data-only line.">
            <input className={`${inputClass} num`} inputMode="tel" value={value.phoneNumber || ''} onChange={(e) => onChange({ phoneNumber: e.target.value })} />
          </Field>
        )}
        {value.hasCellular && (
          <Field label="Carrier">
            <VendorPicker value={value.carrier || null} onChange={(v) => onChange({ carrier: v, carrierCompanyId: v ? v.id : null })} />
          </Field>
        )}
      </div>
    </div>
  );
}

// The fields DeviceFields edits, as the API takes them.
export function deviceFieldsBody(v) {
  return {
    isManaged: !!v.isManaged,
    mdmId: v.isManaged ? v.mdmId || null : null,
    mdmDeviceId: v.isManaged ? v.mdmDeviceId || null : null,
    hasCellular: !!v.hasCellular,
    ...(v.hasCellular ? { imei: v.imei || '', phoneNumber: v.phoneNumber || '', carrierCompanyId: v.carrierCompanyId || null } : {}),
  };
}
