// Small pieces of the project page: the stat card, and the avatar
// (components/work) re-exported for the project tabs.
import { CARD_BG, BORDER, MUTED } from '../theme';

export { default as Avatar } from '../../../components/work/Avatar';

export function StatCard({ label, value, color }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight" style={{ color }}>{value}</p>
    </div>
  );
}
