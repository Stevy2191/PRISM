// Costs: the project's expenses and materials as two sections (the former
// Expenses and Materials tabs, with the same permissions).
import { ExpensesTab } from './ExpensesTab';
import { MaterialsTab } from './MaterialsTab';
import BillsPanel from '../../../components/work/BillsPanel';

export default function CostsTab({
  projectId, expenses, materials, canManage, onAddExpense, onDeleteExpense, onMoreExpenses, onAddMaterial, onPickMaterial, onDeleteMaterial, onMoreMaterials,
}) {
  return (
    <div className="space-y-6">
      <section aria-label="Expenses">
        <ExpensesTab data={expenses} canManageExpenses={canManage} onAdd={onAddExpense} onDelete={onDeleteExpense} onLoadMore={onMoreExpenses} />
      </section>
      <section aria-label="Materials">
        <MaterialsTab data={materials} canManageExpenses={canManage} onAdd={onAddMaterial} onPick={onPickMaterial} onDelete={onDeleteMaterial} onLoadMore={onMoreMaterials} />
      </section>
      {projectId && <BillsPanel kind="project" id={projectId} />}
    </div>
  );
}
