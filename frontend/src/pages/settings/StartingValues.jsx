// Settings › Hours & SLAs › Starting values for new companies (CS): the
// targets, support hours and holidays a company is given when it is made.
// Changing them later changes no existing company.
import SettingsPage from '../../components/settings/SettingsPage';
import CompanySla from '../../components/companies/CompanySla';

export default function StartingValues() {
  return (
    <SettingsPage description="What a new company starts with. Each company then has its own, on its page; changing these changes no existing company.">
      <CompanySla base="/sla/starting-values" who="a new company" />
    </SettingsPage>
  );
}
