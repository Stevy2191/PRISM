// Settings › Sign-in & email › Email (CS): the help desk's mailbox, in and
// out, on one page. Owner only.
import { Link } from 'react-router-dom';
import SettingsPage from '../../components/settings/SettingsPage';
import InboundEmailSection from './InboundEmailSection';
import OutboundEmailSection from './OutboundEmailSection';

export default function Email() {
  return (
    <SettingsPage actions={<Link to="/settings/email-log" className="btn-secondary">Email log</Link>}>
      <InboundEmailSection />
      <OutboundEmailSection />
    </SettingsPage>
  );
}
