// A user's initials in a circle (look A: a steady colour per person), or
// "Unassigned" when there is no name.
import { initials } from '../../utils/userDisplay';

// Same hues in both themes; white initials clear 4.5:1 on each.
const HUES = ['#5b4bb7', '#0f7a6c', '#b4531f', '#3d5a80', '#9a3b6b', '#4a6b1f'];

function hueFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export default function Avatar({ name, size = 24 }) {
  if (!name) return <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>;
  return (
    <span
      title={name}
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, backgroundColor: hueFor(name), fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {initials(name)}
    </span>
  );
}
