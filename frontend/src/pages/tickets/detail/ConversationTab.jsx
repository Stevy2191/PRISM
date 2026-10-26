// Conversation tab: the comment thread.
import { IconLock, IconWorld, IconMail } from '@tabler/icons-react';
import LoadMore from '../../../components/LoadMore';
import { initials } from '../../../utils/userDisplay';
import { TEXT, MUTED, timeAgo } from '../theme';
import { DescriptionCard } from './TicketText';

// ---- Conversation tab ----

export function ConversationTab({
  ticket, comments, total, onLoadMore, onSplit, canEditDescription, onSaveDescription,
}) {
  return (
    <div className="space-y-4">
      {/* The original request comes first, above any older messages. */}
      <DescriptionCard description={ticket.description} canEdit={canEditDescription} onSave={onSaveDescription} />
      {/* Older messages sit above the thread, where they'd be if they were
          already loaded. */}
      <LoadMore loaded={comments.length} total={total} onLoadMore={onLoadMore} noun="messages" />
      {comments.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No messages yet.</p>}
      {comments.map((c) => {
        const isCustomer = c.authorId === ticket.requesterId;
        const isPrivate = c.type === 'comment_private';
        const isPublicComment = c.type === 'comment_public';
        return (
          <div key={c.id} className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: isCustomer ? 'var(--color-accent)' : 'var(--color-success)' }}
            >
              {initials(c.author?.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: TEXT }}>{c.author?.displayName}</span>
                <span
                  className="rounded-[3px] px-2 py-0.5 text-[10px] font-medium"
                  style={
                    isCustomer
                      ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, var(--color-bg))', color: 'var(--color-accent)' }
                      : { backgroundColor: 'color-mix(in srgb, var(--color-success) 20%, var(--color-bg))', color: 'var(--color-success)' }
                  }
                >
                  {isCustomer ? 'Customer' : 'Tech'}
                </span>
                {isPrivate && (
                  <span className="conv-badge--private flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[10px] font-medium">
                    <IconLock size={10} /> Private comment
                  </span>
                )}
                {isPublicComment && (
                  <span className="conv-badge--public flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[10px] font-medium">
                    <IconWorld size={10} /> Comment
                  </span>
                )}
                {c.viaEmail && (
                  <span className="flex items-center gap-1 rounded-[3px] border px-2 py-0.5 text-[10px] font-medium" style={{ color: MUTED }} title="Captured from an email sent to the helpdesk mailbox">
                    <IconMail size={10} /> via email
                  </span>
                )}
                <span className="text-xs" style={{ color: MUTED }}>{timeAgo(c.createdAt)}</span>
                {onSplit && (
                  <button
                    type="button"
                    onClick={() => onSplit(c)}
                    className="ml-auto text-xs hover:underline"
                    style={{ color: MUTED }}
                    title="Make this message a new ticket"
                  >
                    Split to new ticket
                  </button>
                )}
              </div>
              {/* Bubble colors are hardcoded per theme via CSS classes (not
                  --color-* variables) so they stay readable no matter what
                  custom background color an admin or user has set. */}
              <div
                className={`conv-bubble mt-1 ${
                  isPrivate
                    ? 'conv-bubble--private'
                    : isPublicComment
                    ? 'conv-bubble--public'
                    : isCustomer
                    ? 'conv-bubble--customer'
                    : 'conv-bubble--tech'
                }`}
              >
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
