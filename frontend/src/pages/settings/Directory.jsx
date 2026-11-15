// Settings › Sign-in & email › Directory (CS): Active Directory / LDAP
// sign-in, and syncing contacts from it, on one page. They share one
// connection. Owner only: the route guards it, the server refuses others.
import SettingsPage from '../../components/settings/SettingsPage';
import LdapSection from './LdapSection';
import DirectorySync from './DirectorySync';

export default function Directory() {
  return (
    <SettingsPage>
      <LdapSection />
      <DirectorySync embedded />
    </SettingsPage>
  );
}
