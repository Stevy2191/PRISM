import { Link } from 'react-router-dom';
import SettingsPage from '../../components/settings/SettingsPage';
import InboundEmailSection from './InboundEmailSection';

export default function IncomingEmail() {
  return (
    <SettingsPage actions={<Link to="/settings/email-log" className="btn-secondary">Email log</Link>}>
      <InboundEmailSection />
    </SettingsPage>
  );
}
