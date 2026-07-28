// Shared modal/dialog shell. Promoted from the near-identical local `Modal`
// components previously duplicated in TicketDetail.jsx and ProjectDetail.jsx.
export default function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className={`card w-full rounded-none sm:rounded-lg ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[100dvh] overflow-y-auto p-5 sm:max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2.5 border-b border-navy-100 pb-3">
          <span className="h-4 w-1 flex-shrink-0 rounded-full bg-prism" />
          <h2 className="text-base font-semibold tracking-tight text-navy-900">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
