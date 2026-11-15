// Project numbers per company (CN part 3): WC-HR-P0007 is Washington
// County's 7th project, for its Human Resources; WC-P0006 is for the whole
// company. One counter per company across its departments (CompanyCounters,
// kind 'project'). The department is fixed when the project is made: moving
// "For" later keeps the number. Every code a project had stays in
// previousCodes so it can still be found.
const { QueryTypes } = require('sequelize');
const { nextSeq } = require('../tickets/numbers');

const pad4 = (n) => (n > 9999 ? String(n) : String(n).padStart(4, '0'));
const formatProjectCode = (companyCode, departmentCode, seq) => (departmentCode
  ? `${companyCode}-${departmentCode}-P${pad4(seq)}`
  : `${companyCode}-P${pad4(seq)}`);

function models() {
  return require('../../models'); // eslint-disable-line global-require
}

const withPrevious = (list, code) => {
  const prev = Array.isArray(list) ? list : [];
  return code && !prev.includes(code) ? [...prev, code] : prev;
};

// The next number in the project's company, with its department's code.
async function nextCode(companyId, forDepartmentId, transaction) {
  const { Company, Department } = models();
  const company = await Company.findByPk(companyId, { attributes: ['id', 'code'], transaction });
  if (!company) throw new Error(`Company ${companyId} not found`);
  const dept = forDepartmentId
    ? await Department.findOne({ where: { id: forDepartmentId, companyId }, attributes: ['id', 'shortCode'], transaction })
    : null;
  const seq = await nextSeq(companyId, 'project', transaction);
  return { seq, code: formatProjectCode(company.code, dept && dept.shortCode, seq) };
}

// Rewrites a project's task (and subtask) codes from one prefix to another.
async function renameTaskCodes(projectId, from, to, transaction) {
  if (!from || from === to) return;
  const { sequelize } = models();
  await sequelize.query(
    'UPDATE Tasks SET code = CONCAT(:to, SUBSTRING(code, :cut)) WHERE projectId = :projectId AND code LIKE :like',
    {
      replacements: {
        to, cut: from.length + 1, projectId, like: `${from.replace(/[\\%_]/g, '\\$&')}-%`,
      },
      transaction,
    },
  );
}

// Project hooks.
async function beforeCreate(project, options) {
  if (project.projectCode || !project.companyId) return;
  const { seq, code } = await nextCode(project.companyId, project.forDepartmentId, options && options.transaction);
  project.companySeq = seq;
  project.projectCode = code;
}

// A project moved to another company takes the next number there.
async function beforeUpdate(project, options) {
  if (!project.changed('companyId') || !project.companyId) return;
  const old = project.previous('projectCode') || project.projectCode;
  const transaction = options && options.transaction;
  const { seq, code } = await nextCode(project.companyId, project.forDepartmentId, transaction);
  project.companySeq = seq;
  project.projectCode = code;
  project.previousCodes = withPrevious(project.previousCodes, old);
  await renameTaskCodes(project.id, old, code, transaction);
}

// Projects moved in bulk (a company merge): each takes the next number in
// the company it is now in.
async function renumberMoved(projectIds, transaction) {
  if (!projectIds || !projectIds.length) return;
  const { Project } = models();
  const projects = await Project.findAll({ where: { id: projectIds }, order: [['id', 'ASC']], transaction });
  for (const project of projects) {
    const old = project.projectCode;
    const { seq, code } = await nextCode(project.companyId, project.forDepartmentId, transaction); // eslint-disable-line no-await-in-loop
    await project.update( // eslint-disable-line no-await-in-loop
      { companySeq: seq, projectCode: code, previousCodes: withPrevious(project.previousCodes, old) },
      { transaction, hooks: false },
    );
    await renameTaskCodes(project.id, old, code, transaction); // eslint-disable-line no-await-in-loop
  }
}

// A company's code changed: its projects' codes (and their tasks') follow.
async function followCompanyCode(companyId, oldCode, newCode, transaction) {
  if (!oldCode || oldCode === newCode) return;
  const { sequelize } = models();
  const run = (sql) => sequelize.query(sql, { replacements: { companyId, oldCode, newCode, cut: oldCode.length + 1 }, transaction });
  await run(`UPDATE Tasks k JOIN Projects p ON p.id = k.projectId
     SET k.code = CONCAT(:newCode, SUBSTRING(k.code, :cut))
     WHERE p.companyId = :companyId AND k.code LIKE CONCAT(p.projectCode, '-%') AND p.projectCode LIKE CONCAT(:oldCode, '-%')`);
  await run(`UPDATE Projects
     SET previousCodes = JSON_ARRAY_APPEND(COALESCE(previousCodes, JSON_ARRAY()), '$', projectCode),
         projectCode = CONCAT(:newCode, SUBSTRING(projectCode, :cut))
     WHERE companyId = :companyId AND projectCode LIKE CONCAT(:oldCode, '-%')`);
}

// For search: a project by a code it had (SD-P00007, an old WC-HR-P0007).
function previousCodeWhere(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}(-[A-Z0-9]{1,6})?-P\d{1,9}$/.test(code)) return null;
  const { sequelize } = models();
  return sequelize.literal(`JSON_CONTAINS(\`Project\`.\`previousCodes\`, ${sequelize.escape(JSON.stringify(code))})`);
}

// A project id by any code it has had.
async function findProjectIdByCode(raw, { transaction } = {}) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return null;
  const { Project, sequelize } = models();
  const current = await Project.findOne({ where: { projectCode: code }, attributes: ['id'], transaction });
  if (current) return current.id;
  const rows = await sequelize.query(
    'SELECT id FROM Projects WHERE JSON_CONTAINS(previousCodes, JSON_QUOTE(:code)) ORDER BY id DESC LIMIT 1',
    { replacements: { code }, type: QueryTypes.SELECT, transaction },
  );
  return rows.length ? rows[0].id : null;
}

module.exports = {
  formatProjectCode,
  nextCode,
  renameTaskCodes,
  beforeCreate,
  beforeUpdate,
  renumberMoved,
  followCompanyCode,
  previousCodeWhere,
  findProjectIdByCode,
};
