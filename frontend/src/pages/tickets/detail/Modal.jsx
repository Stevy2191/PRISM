// The ticket page's modal shell.
import { CARD_BG, BORDER, TEXT } from '../theme';

export function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className="max-h-[100dvh] w-full overflow-y-auto rounded-none border p-5 sm:max-h-[90vh] sm:max-w-md sm:rounded-[10px]"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
