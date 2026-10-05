// Attachment drop zone on the new-ticket form.
import { useRef, useState } from 'react';
import { IconX, IconUpload } from '@tabler/icons-react';
import { MAX_FILE_SIZE } from './FormBits';
import { BG, BORDER, TEXT, MUTED, BLUE } from '../theme';

export function Dropzone({ files, onFiles, onRemove }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (list) => {
    const accepted = [];
    Array.from(list).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is larger than 25MB and was not added.`);
        return;
      }
      accepted.push(file);
    });
    if (accepted.length) onFiles(accepted);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition"
        style={{ borderColor: dragOver ? BLUE : BORDER, backgroundColor: dragOver ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))' : BG }}
      >
        <IconUpload size={28} style={{ color: MUTED, margin: '0 auto' }} />
        <p className="mt-2 text-sm font-medium" style={{ color: TEXT }}>
          Drag &amp; drop files here or browse
        </p>
        <p className="mt-1 text-xs" style={{ color: MUTED }}>
          PNG, JPG, PDF, ZIP — max 25MB per file
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.pdf,.zip"
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: BORDER, color: TEXT }}
            >
              {f.file.name}
              <button type="button" onClick={() => onRemove(f.id)} style={{ color: MUTED }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
