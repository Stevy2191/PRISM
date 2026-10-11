// Small pieces of the project page: stat card and drop line; the avatar and
// editable code live in components/work and are re-exported here.
import { CARD_BG, BORDER, MUTED, BLUE } from '../theme';

export { default as Avatar } from '../../../components/work/Avatar';
export { default as EditableCode } from '../../../components/work/EditableCode';

export function StatCard({ label, value, color }) {
  return (
    <div className="rounded-[10px] border p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight" style={{ color }}>{value}</p>
    </div>
  );
}

// Thin animated line marking exactly where a dragged task will land.
export function DropLine() {
  return <div className="drop-line my-1 h-0.5 rounded-full" style={{ backgroundColor: BLUE }} />;
}
