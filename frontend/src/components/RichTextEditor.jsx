import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import {
  IconBold, IconItalic, IconUnderline, IconStrikethrough, IconH1, IconH2, IconH3,
  IconList, IconListNumbers, IconBlockquote, IconCode, IconLink, IconUnlink,
  IconPhoto, IconAlignLeft, IconAlignCenter, IconAlignRight, IconTable,
  IconSeparatorHorizontal, IconArrowBackUp, IconArrowForwardUp, IconHighlight, IconClearFormatting,
} from '@tabler/icons-react';

// Divider between toolbar groups.
function Sep() {
  return <span className="mx-0.5 h-5 w-px self-center" style={{ backgroundColor: 'var(--color-border)' }} />;
}

function Btn({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      className="flex h-8 w-8 items-center justify-center rounded transition disabled:opacity-30"
      style={{
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  Underline,
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
  Image.configure({ inline: false, allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({ placeholder: 'Write the article… use the toolbar for headings, lists, links, images, tables, and more.' }),
];

// Full-formatting rich text editor (TipTap). Controlled by `value` (HTML
// string) / `onChange(html)`. The stored HTML is sanitized server-side on
// save, so the editor itself only needs to worry about authoring UX.
export default function RichTextEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value || '',
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  // Sync external value changes (e.g. loading an existing article) into the
  // editor without clobbering the caret while the user is typing.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((value || '') !== current) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL', prev);
    if (url === null) return; // cancelled
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const addImage = () => {
    const url = window.prompt('Image URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--color-input-border)', backgroundColor: 'var(--color-input-bg)' }}>
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-card)', position: 'sticky', top: 0, zIndex: 5 }}
      >
        <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><IconBold size={17} /></Btn>
        <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><IconItalic size={17} /></Btn>
        <Btn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><IconUnderline size={17} /></Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><IconStrikethrough size={17} /></Btn>
        <Btn title="Highlight" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}><IconHighlight size={17} /></Btn>
        <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded" title="Text color" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="text-sm font-bold leading-none" style={{ color: editor.getAttributes('textStyle').color || 'currentColor' }}>A</span>
          <input
            type="color"
            className="absolute h-0 w-0 opacity-0"
            value={editor.getAttributes('textStyle').color || '#000000'}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>

        <Sep />

        <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><IconH1 size={18} /></Btn>
        <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IconH2 size={18} /></Btn>
        <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><IconH3 size={18} /></Btn>

        <Sep />

        <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><IconList size={17} /></Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><IconListNumbers size={17} /></Btn>
        <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><IconBlockquote size={17} /></Btn>
        <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><IconCode size={17} /></Btn>

        <Sep />

        <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><IconAlignLeft size={17} /></Btn>
        <Btn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><IconAlignCenter size={17} /></Btn>
        <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><IconAlignRight size={17} /></Btn>

        <Sep />

        <Btn title="Add / edit link" active={editor.isActive('link')} onClick={setLink}><IconLink size={17} /></Btn>
        <Btn title="Remove link" disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()}><IconUnlink size={17} /></Btn>
        <Btn title="Insert image by URL" onClick={addImage}><IconPhoto size={17} /></Btn>
        <Btn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><IconTable size={17} /></Btn>
        <Btn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}><IconSeparatorHorizontal size={17} /></Btn>
        <Btn title="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><IconClearFormatting size={17} /></Btn>

        <Sep />

        <Btn title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><IconArrowBackUp size={17} /></Btn>
        <Btn title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><IconArrowForwardUp size={17} /></Btn>
      </div>

      {/* Editable surface */}
      <EditorContent editor={editor} />
    </div>
  );
}
