// Attachments tab.
import { useRef, useState } from 'react';
import { IconUpload, IconFile, IconTrash } from '@tabler/icons-react';
import { BG, CARD_BG, BORDER, TEXT, MUTED, BLUE } from '../theme';

// ---- Attachments tab ----

export function AttachmentsTab({ ticketId, attachments, onUpload, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files) => Array.from(files).forEach((f) => onUpload(f));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((a) => (
          <a
            key={a.id}
            href={`/api/v1/tickets/${ticketId}/attachments/${a.id}/download`}
            className="group relative flex flex-col items-center gap-2 rounded-[10px] border p-4 text-center"
            style={{ borderColor: BORDER, backgroundColor: CARD_BG }}
          >
            <IconFile size={28} style={{ color: MUTED }} />
            <span className="w-full truncate text-xs font-medium" style={{ color: TEXT }}>{a.originalName}</span>
            <span className="text-[10px]" style={{ color: MUTED }}>{(a.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onRemove(a.id); }}
              className="absolute right-1 top-1 rounded p-1 md:hidden md:group-hover:block"
              style={{ color: MUTED }}
            >
              <IconTrash size={14} />
            </button>
          </a>
        ))}
      </div>
      {attachments.length === 0 && <p className="mb-4 text-sm" style={{ color: MUTED }}>No attachments yet.</p>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="mt-4 cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or browse</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}
