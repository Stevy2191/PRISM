// Searchable single-select of the tags on the projects the viewer can see.
import { useRef, useState } from 'react';
import Pill from '../../../components/ui/Pill';
import { useClickOutside } from '../../../hooks/useClickOutside';

export default function TagsMenu({ allTags, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  const shown = allTags.filter((t) => t.toLowerCase().includes(search.toLowerCase()));
  const choose = (tag) => { onChange(tag); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <Pill on={!!value} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {value ? `Tag: ${value}` : 'Tags'}
      </Pill>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-navy-100 bg-surface p-1 shadow-lg">
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags" aria-label="Search tags" className="input mb-1 h-8 w-full text-sm" />
          <div className="max-h-56 overflow-y-auto" role="listbox" aria-label="Tags">
            {value && <button type="button" onClick={() => choose('')} className="block w-full rounded px-3 py-1.5 text-left text-sm text-navy-400 hover:bg-[var(--color-hover)]">Clear filter</button>}
            {shown.map((t) => (
              <button key={t} type="button" role="option" aria-selected={t === value} onClick={() => choose(t)} className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]" style={t === value ? { color: 'var(--color-accent)' } : undefined}>{t}</button>
            ))}
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-navy-400">No tags.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
