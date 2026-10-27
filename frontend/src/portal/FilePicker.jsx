import { useRef } from 'react';
import { IconPaperclip, IconX } from '@tabler/icons-react';

// Choose files to send with a ticket or reply: a drop zone (or, compact, an
// "Attach files" button) plus the chosen list with remove buttons.
export default function FilePicker({ files, onChange, compact = false, id }) {
  const input = useRef(null);
  const add = (list) => onChange([...files, ...Array.from(list || [])].slice(0, 10));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <input ref={input} id={id} type="file" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {compact ? (
        <button type="button" onClick={() => input.current?.click()} className="btn-secondary h-11 self-start sm:h-10">
          <IconPaperclip size={15} aria-hidden="true" />Attach files
        </button>
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
          className="rounded-xl border border-dashed px-4 py-6 text-center text-sm"
          style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
        >
          <IconPaperclip size={18} aria-hidden="true" className="mx-auto" />
          <div className="mt-1.5">
            Drop files here or{' '}
            <button type="button" onClick={() => input.current?.click()} className="font-semibold hover:underline" style={{ color: 'var(--color-accent)' }}>browse</button>
          </div>
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded" style={{ color: 'var(--color-text-muted)' }}>
                <IconX size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
