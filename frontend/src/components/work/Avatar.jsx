// A user's initials in a circle, or "Unassigned".
import { initials } from '../../utils/userDisplay';

export default function Avatar({ name, size = 24 }) {
  if (!name) return <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>;
  return (
    <span
      title={name}
      className="flex flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ width: size, height: size, backgroundColor: 'var(--color-accent)', color: 'white' }}
    >
      {initials(name)}
    </span>
  );
}
