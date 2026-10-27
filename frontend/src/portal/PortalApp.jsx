import { Navigate, Route, Routes } from 'react-router-dom';
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

// Everything under /portal: the client portal, for contacts. Its own auth
// (PortalAuthProvider) and frame, outside the staff Layout.
export default function PortalApp() {
  return (
    <PortalAuthProvider>
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
