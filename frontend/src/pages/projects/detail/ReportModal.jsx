// "Generate report" modal: streams the project's PDF down.
import { useState } from 'react';
import { IconFileText } from '@tabler/icons-react';
import api, { errMessage } from '../../../api/api';
import Button from '../../../components/ui/Button';
import Notice from '../../../components/ui/Notice';
import { Modal } from './Modal';
import { MUTED } from '../theme';

// Fixed set of sections (no configurable filters), so this modal is mainly
// a preview + loading state while the PDF streams down.
export default function GenerateProjectReportModal({ projectId, projectCode, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await api.get(`/projects/${projectId}/report`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-[${projectCode}]-report.pdf`;
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
        Generates a PDF summarizing this project — team, tasks and subtasks, time entries grouped
        by tech with internal/contractor cost breakdown, expenses, materials, and an overall cost
        summary.
      </p>
      {error && <Notice tone="bad" className="mb-3">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={generate} disabled={generating}>
          <IconFileText size={15} />
          {generating ? 'Generating…' : 'Generate PDF'}
        </Button>
      </div>
    </Modal>
  );
}
