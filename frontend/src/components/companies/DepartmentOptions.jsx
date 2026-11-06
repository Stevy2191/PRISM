import { useCompanySummary } from '../../context/CompanyContext';
import { departmentGroups } from '../../utils/departmentGroups';

// The <option>s of a department dropdown, grouped under each company (see
// utils/departmentGroups). companyId narrows it to one company's.
export default function DepartmentOptions({ departments, companyId }) {
  const { multiCompany } = useCompanySummary();
  return departmentGroups(departments, { companyId, multiCompany }).map((g) => {
    const options = g.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>);
    return g.label ? <optgroup key={g.label} label={g.label}>{options}</optgroup> : options;
  });
}
