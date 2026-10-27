// Reply/comment composer under the conversation.
import { useRef, useState } from 'react';
import {
  IconPaperclip, IconAt, IconLock, IconWorld, IconChevronDown,
} from '@tabler/icons-react';
import { AMBER } from '../theme';
import CannedPicker from '../../../components/CannedPicker';

// collapsible (phones): starts as a one-line "Reply" box; tapping it opens
// the full composer.
export function ReplyBox({
  ticket, onSend, fileRef, onAttach, isStaff, canViewPrivateComments, collapsible = false,
}) {
  const draftKey = `prism.ticket.${ticket.id}.draft`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const [mode, setMode] = useState('reply'); // 'reply' | 'comment'
  const [visibility, setVisibility] = useState('private'); // 'private' | 'public'
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // One-off Cc/Bcc for this reply (spec 5a), public messages only.
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const textareaRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const open = !collapsible || expanded;

  const isComment = isStaff && mode === 'comment';
  // Without tickets.view_private_comments, the private/public choice is
  // hidden — comments this user posts are always public.
  const effectiveVisibility = canViewPrivateComments ? visibility : 'public';
  const isPublic = !isComment || effectiveVisibility === 'public';

  const saveDraft = () => { try { localStorage.setItem(draftKey, text); } catch { /* ignore */ } };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      const type = isComment ? (effectiveVisibility === 'public' ? 'comment_public' : 'comment_private') : 'reply';
      const recipients = isStaff && isPublic && showCc ? { emailCc: cc, emailBcc: bcc } : {};
      await onSend(text, type, recipients);
      setText('');
      setCc(''); setBcc('');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not send. Try again.');
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

  // A canned response goes in at the cursor (or replaces the selection).
  const insertText = (snippet) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart ?? text.length : text.length;
    const end = el ? el.selectionEnd ?? start : start;
    setText(text.slice(0, start) + snippet + text.slice(end));
  };

  const placeholder = isComment ? 'Add an internal comment...' : `Reply to ${ticket.contact?.displayName || 'the customer'}...`;
  const seg = (active) => `flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent ${active ? 'font-semibold' : 'font-medium text-navy-500 hover:bg-[var(--color-hover)]'}`;
  const segStyle = (active, tone) => (active
    ? (tone === 'amber' ? { backgroundColor: 'var(--color-waiting-bg)', color: 'var(--color-waiting)' } : { backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)' })
    : undefined);
  const tool = 'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-navy-500 hover:bg-[var(--color-hover)] hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent max-sm:h-11';

  if (!open) {
    return (
      <div className="flex-shrink-0 border-t border-navy-100 bg-surface p-3">
        {/* Looks like a one-line field; it is the button that opens the composer. */}
        <button
          type="button"
          aria-expanded="false"
          aria-label={text ? `Reply (draft: ${text.slice(0, 60)})` : 'Reply'}
          onClick={() => setExpanded(true)}
          className="input flex h-11 w-full cursor-text items-center truncate text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent"
        >
          <span className="truncate" style={text ? undefined : { color: 'var(--color-text-faint)' }}>{text || placeholder}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-navy-100 bg-surface p-3 sm:p-4">
      {(isStaff || collapsible) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {isStaff ? (
            <div className="flex gap-1">
              <button type="button" onClick={() => setMode('reply')} aria-pressed={mode === 'reply'} className={seg(mode === 'reply')} style={segStyle(mode === 'reply')}>
                Reply
              </button>
              <button type="button" onClick={() => setMode('comment')} aria-pressed={mode === 'comment'} className={seg(mode === 'comment')} style={segStyle(mode === 'comment', 'amber')}>
                <IconLock size={13} aria-hidden="true" /> Comment
              </button>
            </div>
          ) : <span />}
          <div className="flex items-center gap-1">
            {isComment && canViewPrivateComments && (
              <div className="flex gap-1">
                <button type="button" onClick={() => setVisibility('private')} aria-pressed={visibility === 'private'} className={seg(visibility === 'private')} style={segStyle(visibility === 'private', 'amber')}>
                  <IconLock size={12} aria-hidden="true" /> Private
                </button>
                <button type="button" onClick={() => setVisibility('public')} aria-pressed={visibility === 'public'} className={seg(visibility === 'public')} style={segStyle(visibility === 'public')}>
                  <IconWorld size={12} aria-hidden="true" /> Public
                </button>
              </div>
            )}
            {collapsible && (
              <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse reply" title="Collapse reply" className="flex h-11 w-11 items-center justify-center rounded-md text-navy-500 hover:bg-[var(--color-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-prism-accent">
                <IconChevronDown size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        autoFocus={collapsible}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="input resize-y text-sm"
        style={{ minHeight: '88px', borderColor: isComment ? AMBER : undefined }}
      />

      {isStaff && isPublic && showCc && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc: addresses, comma-separated" aria-label="Cc" className="input h-8 text-xs" />
          <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Bcc: addresses, comma-separated" aria-label="Bcc" className="input h-8 text-xs" />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {isStaff && isPublic && (
            <button type="button" onClick={() => setShowCc((v) => !v)} aria-pressed={showCc} className={tool} style={showCc ? { color: 'var(--color-text-primary)' } : undefined}>
              Cc/Bcc
            </button>
          )}
          {isStaff && <CannedPicker ticketId={ticket.id} onInsert={insertText} currentText={text} />}
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach a file" aria-label="Attach a file" className={tool}>
            <IconPaperclip size={16} aria-hidden="true" />
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onAttach} />
          <button type="button" onClick={insertAt} title="Mention someone" aria-label="Mention someone" className={tool}>
            <IconAt size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={saveDraft} className="h-10 rounded-md border border-navy-100 bg-surface px-3 text-sm font-semibold text-navy-900 hover:bg-[var(--color-hover)] max-sm:h-11">
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="h-10 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11"
            style={isComment ? { backgroundColor: 'var(--color-warning)', color: 'black' } : { backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
          >
            {sending ? 'Sending…' : isComment ? 'Add Comment' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
