// Files tab.
import { useRef, useState } from 'react';
import { IconUpload, IconFile, IconTrash } from '@tabler/icons-react';
import { BG, CARD_BG, BORDER, TEXT, MUTED, BLUE } from '../theme';

// ==================== Files tab ====================
export function FilesTab({ files, onUpload, onDelete }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const handleFiles = (fl) => Array.from(fl).forEach((f) => onUpload(f));

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="mb-4 cursor-pointer rounded-md border-2 border-dashed p-6 text-center"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={22} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm" style={{ color: TEXT }}>Drag &amp; drop files here or click to browse</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {files.map((f) => (
          <div key={f.id} className="relative rounded-[10px] border p-3" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <a href={`/api/v1/projects/${f.projectId}/files/${f.id}/download`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2">
              <IconFile size={28} style={{ color: MUTED }} />
              <span className="w-full truncate text-center text-xs font-medium" style={{ color: TEXT }}>{f.filename}</span>
              <span className="text-[10px]" style={{ color: MUTED }}>{Math.round(f.filesize / 1024)} KB</span>
            </a>
            <button onClick={() => onDelete(f.id)} className="absolute right-1 top-1" style={{ color: MUTED }}><IconTrash size={14} /></button>
          </div>
        ))}
        {files.length === 0 && <p className="col-span-full text-center text-sm" style={{ color: MUTED }}>No files uploaded yet.</p>}
      </div>
    </div>
  );
}
