import { useEffect, useState } from 'react';
import {
  Navigate, Route, Routes, useLocation, useNavigate, useParams,
} from 'react-router-dom';
import { PortalAuthProvider, RequireContact } from './PortalAuth';
import PortalLayout from './PortalLayout';
import SignIn from './pages/SignIn';
import Forgot from './pages/Forgot';
import SetPassword from './pages/SetPassword';
import Tickets from './pages/Tickets';
import TicketNew from './pages/TicketNew';
import Ticket from './pages/Ticket';
import Kb from './pages/Kb';
import KbArticle from './pages/KbArticle';
import PortalHome from './pages/PortalHome';
import { setPortalSlug, plainApi } from './api';

// One company's portal, at /portal/<slug>: for its contacts. Its own auth
// (PortalAuthProvider) and frame, outside the staff Layout. The slug is set
// before anything below renders, so every page and request is this
// company's.
function CompanyPortal() {
  const { slug } = useParams();
  setPortalSlug(slug);
  return (
    <PortalAuthProvider key={slug}>
      <Routes>
        <Route path="sign-in" element={<SignIn />} />
        <Route path="forgot" element={<Forgot />} />
        <Route path="reset" element={<SetPassword kind="reset" />} />
        <Route path="welcome" element={<SetPassword kind="invite" />} />
        <Route element={<RequireContact><PortalLayout /></RequireContact>}>
          <Route index element={<Navigate to="tickets" replace />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="tickets/new" element={<TicketNew />} />
          <Route path="tickets/:id" element={<Ticket />} />
          <Route path="kb" element={<Kb />} />
          <Route path="kb/a/:slug" element={<KbArticle />} />
          <Route path="*" element={<Navigate to="tickets" replace />} />
        </Route>
      </Routes>
    </PortalAuthProvider>
  );
}

// An old link (the company renamed it): on to the current one, same page.
function CurrentLink({ children }) {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let live = true;
    plainApi.get(`/c/${encodeURIComponent(slug)}/config`)
      .then(({ data }) => {
        const current = data.company?.slug;
        if (live && current && current !== slug) {
          const rest = location.pathname.slice(`/portal/${slug}`.length);
          navigate(`/portal/${current}${rest}${location.search}`, { replace: true });
        } else if (live) setChecked(true);
      })
      .catch(() => live && setChecked(true));
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  return checked ? children : null;
}

export default function PortalApp() {
  return (
    <Routes>
      <Route index element={<PortalHome />} />
      <Route path=":slug/*" element={<CurrentLink><CompanyPortal /></CurrentLink>} />
    </Routes>
  );
}
