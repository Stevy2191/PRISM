// New checklist (PB2): a name and two plain questions, then paste a
// document or start blank.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';

function Choice({
  pressed, title, children, onClick,
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`flex min-h-[64px] w-full flex-col items-start rounded-lg border-2 px-3 py-2 text-left ${pressed ? 'border-prism-accent bg-navy-50' : 'border-navy-100 hover:bg-navy-50'}`}>
      <b className="text-sm text-navy-900">{title}</b>
      <span className="text-xs text-navy-500">{children}</span>
    </button>
  );
}

export default function NewChecklistDialog({ onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [usage, setUsage] = useState('ticket');
  const [finish, setFinish] = useState('nothing');
  const [start, setStart] = useState('paste');

  const next = () => navigate('/settings/checklists/new', {
    state: {
      name: name.trim(), usage, finish: usage === 'device' ? finish : 'nothing', start,
    },
  });

  return (
    <Modal title="New checklist" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) next(); }}>
        <label className="flex flex-col gap-1 text-sm font-medium text-navy-600">
          Name
          <input className="h-10 rounded-md border border-navy-200 bg-surface px-3 text-sm text-navy-900" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Printer setup" />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-navy-600">What is it for?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice pressed={usage === 'ticket'} title="The ticket" onClick={() => setUsage('ticket')}>Added once. For work like setting up or closing an account.</Choice>
            <Choice pressed={usage === 'device'} title="A device" onClick={() => setUsage('device')}>Added once for each device. Steps can be only for some MDMs or device types.</Choice>
          </div>
        </fieldset>
        {usage === 'device' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-navy-600">When it's finished</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Choice pressed={finish === 'nothing'} title="Nothing else" onClick={() => setFinish('nothing')}>Just a list of steps.</Choice>
              <Choice pressed={finish === 'check_out'} title="Check the device out" onClick={() => setFinish('check_out')}>To the person it's for.</Choice>
              <Choice pressed={finish === 'check_in'} title="Check the device in" onClick={() => setFinish('check_in')}>And mark it ready, in repair or on hold.</Choice>
            </div>
            <p className="mt-2 text-xs text-navy-400">PRISM adds this as the last step, and does it when that step is ticked.</p>
          </fieldset>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-navy-600">Start with</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice pressed={start === 'paste'} title="Paste from a document" onClick={() => setStart('paste')}>Each line becomes a step.</Choice>
            <Choice pressed={start === 'blank'} title="A blank checklist" onClick={() => setStart('blank')}>Type the steps yourself.</Choice>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>Next</Button>
        </div>
      </form>
    </Modal>
  );
}
