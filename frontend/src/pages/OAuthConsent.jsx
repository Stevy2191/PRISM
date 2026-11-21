import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api, { errMessage } from '../api/api';
import Spinner from '../components/Spinner';

// /oauth/consent/:id (MCP-O): an app (Claude) asks to act as the signed-in
// person. They allow or deny; the browser then goes back to the app.
// /oauth/consent/error explains a request PRISM couldn't trust.

const ERRORS = {
  unknown_client: 'PRISM doesn\'t recognise the app that sent you here, or it isn\'t one PRISM allows. Start again from the app.',
  bad_redirect: 'The app asked to send you back somewhere it never registered, so PRISM stopped here. Start again from the app.',
};

function Frame({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="w-full max-w-md">
        <h1 className="mb-4 flex items-center justify-center gap-2.5 text-xl font-bold tracking-tight text-navy-900">
          <span aria-hidden="true" className="h-7 w-7 rounded-lg" style={{ backgroundColor: 'var(--color-accent)' }} />
          PRISM
        </h1>
        <div className="card space-y-4 p-6">{children}</div>
      </div>
    </div>
  );
}

export function OAuthConsentError() {
  const [params] = useSearchParams();
  return (
    <Frame>
      <h2 className="text-lg font-semibold text-navy-900">Can&apos;t connect that app</h2>
      <p className="text-sm text-navy-600">{ERRORS[params.get('reason')] || 'Something about this request wasn\'t right. Start again from the app.'}</p>
    </Frame>
  );
}

export default function OAuthConsent() {
  const { id } = useParams();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/oauth/requests/${encodeURIComponent(id)}`)
      .then(({ data }) => setRequest(data))
      .catch((err) => setError(errMessage(err)));
  }, [id]);

  const answer = async (allow) => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/oauth/requests/${encodeURIComponent(id)}/decision`, { allow });
      window.location.assign(data.redirectTo);
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  };

  if (!request && !error) return <Spinner className="min-h-screen" />;
  if (!request) {
    return (
      <Frame>
        <h2 className="text-lg font-semibold text-navy-900">Can&apos;t connect that app</h2>
        <p role="alert" className="text-sm text-navy-600">{error}</p>
      </Frame>
    );
  }

  const name = request.client.name;
  return (
    <Frame>
      <h2 className="text-lg font-semibold text-navy-900">Connect {name} to PRISM?</h2>
      <p className="text-sm text-navy-600">
        {name} will act as <span className="font-medium text-navy-900">{request.user.displayName || request.user.username}</span>,
        with your permissions, until you or an administrator disconnect it.
      </p>
      <div className="rounded-md bg-navy-50 p-3 text-sm text-navy-700">
        <p className="mb-1 font-medium">It will be able to</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>see the tickets, projects, companies, contacts, assets and articles you can see</li>
          {request.allowWrites
            ? <li>create and update tickets, add notes and replies (replies are emailed to customers), and log time, as you</li>
            : <li>only look: it can&apos;t change anything</li>}
        </ul>
      </div>
      <p className="text-xs text-navy-500">You&apos;ll go back to <span className="font-medium">{request.redirectHost}</span>.</p>
      {error && <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => answer(false)}>Deny</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => answer(true)}>Allow</button>
      </div>
    </Frame>
  );
}
