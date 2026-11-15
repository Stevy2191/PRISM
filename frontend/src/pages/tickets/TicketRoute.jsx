import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import api from '../../api/api';
import TicketDetail from './TicketDetail';
import Spinner from '../../components/Spinner';

// /tickets/42 is the ticket; /tickets/WC-T0042 (CN), or any number it has
// had, goes to it.
export default function TicketRoute() {
  const { id } = useParams();
  const byId = /^\d+$/.test(id || '');
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (byId) return undefined;
    let live = true;
    setFound(null);
    api.get(`/tickets/${encodeURIComponent(id)}`)
      .then(({ data }) => { if (live) setFound(data.ticket ? data.ticket.id : 'missing'); })
      .catch(() => { if (live) setFound('missing'); });
    return () => { live = false; };
  }, [id, byId]);
  if (byId) return <TicketDetail />;
  if (found === null) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (found === 'missing') return <p className="p-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>No ticket {id}.</p>;
  return <Navigate to={`/tickets/${found}`} replace />;
}
