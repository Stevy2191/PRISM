// Relationships tab and the Link ticket modal.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowUp, IconArrowDown, IconX } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { formatTicketId } from '../../../utils/ticketId';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, PURPLE, PURPLE_LIGHT, fieldStyle } from '../theme';
import { Modal } from './Modal';

// ---- Relationships tab + Link ticket modal ----

// One search-and-pick-then-confirm section inside the Link ticket modal.
// Two-step (pick a result, then click Link) rather than link-on-click, so a
// stray click on a search result can't silently create a relationship.
function LinkSection({ label, accent, ticketId, linking, onConfirm }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/tickets', { params: { search: query.trim() } })
        .then(({ data }) => setResults(data.tickets.filter((x) => x.id !== Number(ticketId)).slice(0, 8)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, ticketId]);

  return (
    <div>
      <p className="text-sm font-semibold" style={{ color: accent }}>{label}</p>
      {!selected ? (
        <div className="relative mt-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ticket number or title…"
            className="input"
            style={fieldStyle}
          />
          {results.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border p-1 shadow-lg" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
              {results.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelected(t); setQuery(''); setResults([]); }}
                  className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/5"
                  style={{ color: TEXT }}
                >
                  {formatTicketId(t)} {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-sm" style={{ borderColor: BORDER, color: TEXT }}>
            {formatTicketId(selected)} {selected.title}
          </span>
          <button type="button" onClick={() => setSelected(null)} className="text-xs font-medium" style={{ color: MUTED }}>
            Clear
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={linking}
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {linking ? 'Linking…' : 'Link'}
          </button>
        </div>
      )}
    </div>
  );
}

// Shared by the header's "Link ticket" button and the Relationships tab's
// "+ Set parent" / "+ Add child" / "+ Add related" links — one modal, three
// options, so both entry points behave identically.
export function LinkTicketModal({ ticketId, onClose, onLinked }) {
  const [linking, setLinking] = useState(false);

  const doLink = async (relationType, ticket) => {
    setLinking(true);
    try {
      await api.post(`/tickets/${ticketId}/relations`, { relatedTicketId: ticket.id, relationType });
      onLinked();
      onClose();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Modal title="Link ticket" onClose={onClose}>
      <div className="space-y-5">
        <LinkSection
          label="Set as parent of this ticket"
          accent={PURPLE}
          ticketId={ticketId}
          linking={linking}
          onConfirm={(t) => doLink('parent', t)}
        />
        <div className="border-t pt-5" style={{ borderColor: BORDER }}>
          <LinkSection
            label="Add child ticket"
            accent={BLUE}
            ticketId={ticketId}
            linking={linking}
            onConfirm={(t) => doLink('child', t)}
          />
        </div>
        <div className="border-t pt-5" style={{ borderColor: BORDER }}>
          <LinkSection
            label="Add related ticket"
            accent={MUTED}
            ticketId={ticketId}
            linking={linking}
            onConfirm={(t) => doLink('related', t)}
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function RelationChip({ Icon, accent, accentLight, ticket, isStaff, onRemove }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accentLight }}
    >
      {Icon && <Icon size={12} />}
      <Link to={`/tickets/${ticket.id}`} className="hover:underline">{formatTicketId(ticket)} {ticket.title}</Link>
      {isStaff && (
        <button type="button" onClick={onRemove} style={{ color: accentLight }} title="Remove relationship">
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}

export function RelationshipsTab({ ticketId, relations, isStaff, reload, closedStatusNames }) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  const parent = relations.filter((r) => r.relationType === 'parent' && r.direction === 'outgoing');
  const children = relations.filter((r) => r.relationType === 'parent' && r.direction === 'incoming');
  const related = relations.filter((r) => r.relationType !== 'parent');

  const closedChildren = children.filter((r) => closedStatusNames.includes(r.ticket.status)).length;
  const childPercent = children.length ? Math.round((closedChildren / children.length) * 100) : 0;

  const unlink = async (relationId, label) => {
    if (!window.confirm(`Remove this relationship${label ? ` (${label})` : ''}?`)) return;
    try {
      await api.delete(`/tickets/${ticketId}/relations/${relationId}`);
      reload();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold" style={{ color: PURPLE }}>Parent ticket</p>
        {parent[0] ? (
          <div className="mt-2">
            <RelationChip Icon={IconArrowUp} accent={PURPLE} accentLight={PURPLE_LIGHT} ticket={parent[0].ticket} isStaff={isStaff} onRemove={() => unlink(parent[0].id, 'parent')} />
          </div>
        ) : (
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            No parent ticket.{' '}
            {isStaff && (
              <button type="button" onClick={() => setLinkModalOpen(true)} className="font-medium hover:underline" style={{ color: PURPLE }}>
                + Set parent
              </button>
            )}
          </p>
        )}
      </div>

      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <p className="text-sm font-semibold" style={{ color: BLUE }}>Child tickets</p>
        {children.length > 0 ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {children.map((r) => (
                <RelationChip key={r.id} Icon={IconArrowDown} accent={BLUE} accentLight={BLUE} ticket={r.ticket} isStaff={isStaff} onRemove={() => unlink(r.id, 'child')} />
              ))}
            </div>
            <div className="mt-3">
              <div className="h-[5px] w-full rounded-[3px]" style={{ backgroundColor: BORDER }}>
                <div className="h-full rounded-[3px]" style={{ width: `${childPercent}%`, backgroundColor: BLUE }} />
              </div>
              <p className="mt-1 text-xs" style={{ color: MUTED }}>{closedChildren} of {children.length} children closed ({childPercent}%)</p>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm" style={{ color: MUTED }}>No child tickets.</p>
        )}
        {isStaff && (
          <button type="button" onClick={() => setLinkModalOpen(true)} className="mt-2 text-sm font-medium hover:underline" style={{ color: BLUE }}>
            + Add child
          </button>
        )}
      </div>

      <div className="border-t pt-5" style={{ borderColor: BORDER }}>
        <p className="text-sm font-semibold" style={{ color: MUTED }}>Related tickets</p>
        {related.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {related.map((r) => (
              <RelationChip key={r.id} accent={MUTED} accentLight={MUTED} ticket={r.ticket} isStaff={isStaff} onRemove={() => unlink(r.id, 'related')} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm" style={{ color: MUTED }}>No related tickets.</p>
        )}
        {isStaff && (
          <button type="button" onClick={() => setLinkModalOpen(true)} className="mt-2 text-sm font-medium hover:underline" style={{ color: MUTED }}>
            + Add related
          </button>
        )}
      </div>

      {linkModalOpen && (
        <LinkTicketModal ticketId={ticketId} onClose={() => setLinkModalOpen(false)} onLinked={reload} />
      )}
    </div>
  );
}
