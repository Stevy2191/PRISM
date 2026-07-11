// Shared modal/dialog shell. Promoted from the near-identical local `Modal`
// components previously duplicated in TicketDetail.jsx and ProjectDetail.jsx.
export default function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className={`card w-full rounded-none sm:rounded-lg ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[100dvh] overflow-y-auto p-5 sm:max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold text-navy-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}
