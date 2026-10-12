// The owner (a crown) and secondary owners (a star), next to an account's
// name. Ownership is a mark on a System Administrator's account (user
// decision 2026-10-11).
import { IconCrown, IconStarFilled } from '@tabler/icons-react';

export default function OwnerBadge({ level, size = 16 }) {
  if (level === 'owner') {
    return (
      <span title="Owner" aria-label="Owner" role="img" className="inline-flex align-middle text-amber-500">
        <IconCrown size={size} />
      </span>
    );
  }
  if (level === 'secondary') {
    return (
      <span title="Secondary owner" aria-label="Secondary owner" role="img" className="inline-flex align-middle text-amber-400">
        <IconStarFilled size={size} />
      </span>
    );
  }
  return null;
}
