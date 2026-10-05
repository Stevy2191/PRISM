// The ticket's Generate report (PDF) modal.
import { useState } from 'react';
import { IconFileText } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import { Modal } from './Modal';
import { BORDER, TEXT, MUTED, BLUE } from '../theme';

// The report has a fixed set of sections (no configurable filters) — the
// "configure and generate" modal is mainly a preview + a loading state
// while the PDF streams down, since generation can take a moment for a
// ticket with a lot of history.
export function GenerateReportModal({ ticketId, ticketNumber, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await api.get(`/tickets/${ticketId}/report`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticket-#${ticketNumber}-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal title="Generate report" onClose={onClose}>
      <p className="mb-4 text-sm" style={{ color: MUTED }}>
        Generates a PDF summarizing this ticket — status, description, resolution, the public
        conversation (private comments are never included), time entries and cost, attachments,
        and a key-events activity log.
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium" style={{ borderColor: BORDER, color: TEXT }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: BLUE }}
        >
          <IconFileText size={15} />
          {generating ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>
    </Modal>
  );
}
