// "Only for" (PB2): tick MDMs and/or device types; a sentence confirms it.
// Both groups must match; an empty group matches any device.
import { useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import { describeOnlyFor } from './editorModel';

function Group({ legend, options, chosen, onToggle }) {
  return (
    <fieldset className="min-w-0 flex-1">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-400">{legend}</legend>
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <label key={String(o.id)} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-navy-50">
            <input type="checkbox" className="h-4 w-4" checked={chosen.includes(o.id)} onChange={() => onToggle(o.id)} />
            <span>{o.name}</span>
          </label>
        ))}
        {!options.length && <p className="text-sm text-navy-400">None set up yet.</p>}
      </div>
    </fieldset>
  );
}

export default function OnlyForPicker({
  value, lookups, what = 'step', onDone, onClose,
}) {
  const [mdm, setMdm] = useState(value ? value.mdm : []);
  const [categoryId, setCategoryId] = useState(value ? value.categoryId : []);
  const toggle = (list, set) => (id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const mdmOptions = [...lookups.mdms.map((m) => ({ id: m.id, name: m.name })), { id: 'none', name: 'Not managed' }];
  const sentence = describeOnlyFor({ mdm, categoryId }, lookups);
  const limited = mdm.length || categoryId.length;
  return (
    <Modal title="Only for" onClose={onClose}>
      <p className="mb-4 text-sm text-navy-500">Show this {what} only for these devices. Leave a group empty for any.</p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Group legend="MDM" options={mdmOptions} chosen={mdm} onToggle={toggle(mdm, setMdm)} />
        <Group legend="Device type" options={lookups.categories} chosen={categoryId} onToggle={toggle(categoryId, setCategoryId)} />
      </div>
      <p className="mt-4 rounded-md bg-navy-50 px-3 py-2 text-sm" role="status">
        {sentence}{limited ? '. Hidden for every other device.' : '.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="quiet" onClick={() => onDone(null)}>Show for every device</Button>
        <Button variant="primary" onClick={() => onDone({ mdm, categoryId })}>Done</Button>
      </div>
    </Modal>
  );
}
