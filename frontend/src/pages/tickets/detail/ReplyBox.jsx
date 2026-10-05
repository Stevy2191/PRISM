// Reply/comment composer under the conversation.
import { useRef, useState } from 'react';
import { IconPaperclip, IconAt, IconLock, IconWorld } from '@tabler/icons-react';
import { CARD_BG, BORDER, TEXT, MUTED, BLUE, fieldStyle, AMBER } from '../theme';

export function ReplyBox({ ticket, onSend, fileRef, onAttach, isStaff, canViewPrivateComments }) {
  const draftKey = `prism.ticket.${ticket.id}.draft`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const [mode, setMode] = useState('reply'); // 'reply' | 'comment'
  const [visibility, setVisibility] = useState('private'); // 'private' | 'public'
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);

  const isComment = isStaff && mode === 'comment';
  // Without tickets.view_private_comments, the private/public choice is
  // hidden — comments this user posts are always public.
  const effectiveVisibility = canViewPrivateComments ? visibility : 'public';

  const saveDraft = () => { try { localStorage.setItem(draftKey, text); } catch { /* ignore */ } };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const type = isComment ? (effectiveVisibility === 'public' ? 'comment_public' : 'comment_private') : 'reply';
      await onSend(text, type);
      setText('');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } finally {
      setSending(false);
    }
  };

  const insertAt = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? text.length;
    setText(text.slice(0, pos) + '@' + text.slice(pos));
  };

  const tabStyle = (active, activeColor) => ({
    padding: '4px 12px',
    fontSize: '0.75rem',
    fontWeight: 600,
    backgroundColor: active ? activeColor : 'transparent',
    color: active ? 'black' : MUTED,
  });

  return (
    <div className="flex-shrink-0 border-t p-4" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isComment ? 'Add an internal comment...' : `Reply to ${ticket.contact?.displayName || 'the customer'}...`}
        className="input resize-y"
        style={{ ...fieldStyle, minHeight: '80px', borderColor: isComment ? AMBER : BORDER }}
      />

      {isStaff && (
        <div className="mt-2 flex items-center justify-between">
          <div className="flex overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
            <button type="button" onClick={() => setMode('reply')} style={tabStyle(mode === 'reply', BLUE)}>
              Reply
            </button>
            <button type="button" onClick={() => setMode('comment')} style={tabStyle(mode === 'comment', AMBER)}>
              Comment
            </button>
          </div>
          {isComment && canViewPrivateComments && (
            <div className="flex overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className="flex items-center gap-1"
                style={tabStyle(visibility === 'private', AMBER)}
              >
                <IconLock size={12} /> Private
              </button>
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className="flex items-center gap-1"
                style={tabStyle(visibility === 'public', BLUE)}
              >
                <IconWorld size={12} /> Public
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach a file" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconPaperclip size={16} />
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onAttach} />
          <button type="button" onClick={insertAt} title="Mention someone" className="rounded-md border p-2" style={{ borderColor: BORDER, color: MUTED }}>
            <IconAt size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={saveDraft} className="rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: isComment ? AMBER : BLUE, color: isComment ? 'black' : 'white' }}
          >
            {sending ? 'Sending…' : isComment ? 'Add Comment' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
