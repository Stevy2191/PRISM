import { useState } from 'react';
import { IconX } from '@tabler/icons-react';

// Freeform tag input — type and press Enter to add, × to remove. Shared by
// ticket and project creation/detail forms.
export default function TagInput({ tags, onChange }) {
  const [value, setValue] = useState('');

  const addTag = () => {
    const v = value.trim();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setValue('');
  };
  const removeTag = (tag) => onChange(tags.filter((t) => t !== tag));

  return (
    <div
      className="input flex min-h-[2.75rem] flex-wrap items-center gap-1.5 py-1.5"
      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
        >
          {tag}
          <button type="button" onClick={() => removeTag(tag)} style={{ color: 'var(--color-text-muted)' }}>
            <IconX size={12} />
          </button>
        </span>
      ))}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); addTag(); }
        }}
        placeholder={tags.length ? '' : 'Type a tag and press Enter'}
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none"
        style={{ color: 'var(--color-text-primary)' }}
      />
    </div>
  );
}
