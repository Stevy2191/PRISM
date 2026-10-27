// Conversation tab: the comment thread.
import { IconLock, IconWorld, IconMail } from '@tabler/icons-react';
import LoadMore from '../../../components/LoadMore';
import Avatar from '../../../components/ui/Avatar';
import { TEXT, MUTED, timeAgo } from '../theme';

// ---- Conversation tab ----

export function ConversationTab({
  ticket, comments, total, onLoadMore, onSplit,
}) {
  return (
    <div className="space-y-3">
      {/* Older messages sit above the thread, where they'd be if they were
          already loaded. */}
      <LoadMore loaded={comments.length} total={total} onLoadMore={onLoadMore} noun="messages" />
      {comments.length === 0 && <p className="text-sm" style={{ color: MUTED }}>No messages yet.</p>}
      {comments.map((c) => {
        // A customer reply (portal or email) is marked; a portal reply also
        // names the contact who wrote it.
        const isCustomer = !!c.fromCustomer || !!c.authorContact || c.authorId === ticket.requesterId;
        const name = c.authorContact?.displayName || (c.fromCustomer ? ticket.contact?.displayName : null) || c.author?.displayName;
        const isPrivate = c.type === 'comment_private';
        const isPublicComment = c.type === 'comment_public';
        return (
          <div key={c.id} className="flex items-start gap-3">
            <span className="mt-1 max-sm:hidden"><Avatar name={name || '?'} size={32} /></span>
            <div
              className={`conv-bubble min-w-0 flex-1 ${
                isPrivate
                  ? 'conv-bubble--private'
                  : isPublicComment
                  ? 'conv-bubble--public'
                  : isCustomer
                  ? 'conv-bubble--customer'
                  : 'conv-bubble--tech'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: MUTED }}>
                <span className="text-sm font-semibold" style={{ color: TEXT }}>{name}</span>
                <span>{isCustomer ? 'Customer' : 'Tech'}</span>
                {isPrivate && (
                  <span className="conv-badge--private flex items-center gap-1 font-semibold">
                    <IconLock size={12} aria-hidden="true" /> Private comment
                  </span>
                )}
                {isPublicComment && (
                  <span className="conv-badge--public flex items-center gap-1 font-semibold">
                    <IconWorld size={12} aria-hidden="true" /> Comment
                  </span>
                )}
                <span>· {timeAgo(c.createdAt)}</span>
                {c.viaEmail && (
                  <span className="flex items-center gap-1" title="Captured from an email sent to the helpdesk mailbox">
                    · <IconMail size={12} aria-hidden="true" /> via email
                  </span>
                )}
                {onSplit && (
                  <button
                    type="button"
                    onClick={() => onSplit(c)}
                    className="ml-auto hover:underline"
                    title="Make this message a new ticket"
                  >
                    Split to new ticket
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
