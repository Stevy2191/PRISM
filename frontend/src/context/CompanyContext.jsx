import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/api';
import { useAuth } from './AuthContext';

// The company UI switch (spec: "The company picker"): every company column,
// filter and picker stays hidden until a client company exists. Pages call
// refresh() after creating, merging, deleting or re-flagging a company.
const CompanyContext = createContext({ count: 0, multiCompany: false, refresh: () => {} });

export function CompanyProvider({ children }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ count: 0, multiCompany: false });
  const refresh = useCallback(() => {
    if (!user) return;
    api.get('/companies/summary').then(({ data }) => setSummary(data)).catch(() => {});
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  return <CompanyContext.Provider value={{ ...summary, refresh }}>{children}</CompanyContext.Provider>;
}

export function useCompanySummary() {
  return useContext(CompanyContext);
}
