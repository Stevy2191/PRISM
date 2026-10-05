// "Name · Company · Department" — how a contact is labelled everywhere
// (spec: Screens). The company part shows only while company UI is on.
// `company` overrides contact.company (a ticket carries its own company).
export function contactLabel(contact, { multiCompany = false, company } = {}) {
  if (!contact) return '';
  const companyName = multiCompany ? (company || contact.company)?.name : null;
  return [contact.displayName, companyName, contact.department?.name].filter(Boolean).join(' · ');
}
