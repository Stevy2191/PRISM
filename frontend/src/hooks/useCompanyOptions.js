import { useEffect, useState } from 'react';
import api from '../api/api';
import { useCompanySummary } from '../context/CompanyContext';

// Active client companies (and the internal one) the user can reach, for
// pickers and filters. Empty while company UI is off, and for users without
// companies.view (the API refuses them; their records go to the internal
// company by default).
export function useCompanyOptions() {
  const { multiCompany } = useCompanySummary();
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    if (!multiCompany) {
      setCompanies([]);
      return;
    }
    api.get('/companies', { params: { kind: 'client', status: 'active', limit: 200 } })
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => setCompanies([]));
  }, [multiCompany]);
  return companies;
}
