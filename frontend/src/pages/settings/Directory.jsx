// Active Directory / LDAP, out of the old General Settings (spec: Settings
// redesign). Owner only: the route guards it, the server refuses others.
import SettingsPage from '../../components/settings/SettingsPage';
import LdapSection from './LdapSection';

export default function Directory() {
  return <SettingsPage><LdapSection /></SettingsPage>;
}
