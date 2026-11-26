// Whether Customer billing is on (Phase 3): its screens show only then.
import { useEffect, useState } from 'react';
import api from '../../api/api';

export default function useMoneyConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/money/config').then(({ data }) => { if (live) setConfig(data); }).catch(() => { if (live) setConfig({ customerBilling: false }); });
    return () => { live = false; };
  }, []);
  return config;
}
