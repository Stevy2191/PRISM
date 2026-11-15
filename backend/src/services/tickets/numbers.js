// Ticket numbers per company (CN part 2): Washington County's tickets are
// WC-T0001, WC-T0002…, counted in CompanyCounters (kind 'ticket'). The ticket's id stays
// its key; `number` is what people see, and every number a ticket had
// (00042 before CN, an old code, another company's) stays in
// previousNumbers so it can still be found.
const { Op, QueryTypes } = require('sequelize');

const pad4 = (n) => (n > 9999 ? String(n) : String(n).padStart(4, '0'));
// The number every ticket had before CN: its id, five digits.
const legacyNumber = (id) => (id > 99999 ? String(id) : String(id).padStart(5, '0'));
const formatTicketNumber = (code, seq) => `${code}-T${pad4(seq)}`;

// What to show for a ticket (a model instance or a plain row). Falls back to
// the old number for a row read without `number`.
function ticketNumberOf(ticket) {
  if (!ticket) return '';
  const number = typeof ticket.get === 'function' ? ticket.get('number') : ticket.number;
  return number || (ticket.id ? legacyNumber(ticket.id) : '');
}

// A ticket task's code starts with its ticket's number: WC-T0042-T04.
const taskPrefixOf = (ticket) => ticketNumberOf(ticket);

const NUMBER_RE = /^([A-Z0-9]{2,6})-T(\d{1,9})$/;
// "wc-t42", "WC-T0042" → "WC-T0042"; anything else → null.
function normalizeTicketNumber(raw) {
  const m = NUMBER_RE.exec(String(raw || '').trim().toUpperCase());
  return m ? formatTicketNumber(m[1], parseInt(m[2], 10)) : null;
}

function models() {
  return require('../../models'); // eslint-disable-line global-require
}

// A company's next number of a kind ('ticket', 'project'). CompanyCounters
// has no foreign keys, so a lock on the company's row (any insert that points
// at it) never blocks the count. Inside the caller's transaction when there
// is one (no second connection: a pool full of open transactions must not
// wait on itself), holding the counter row until it commits, so two new
// tickets never share a number. The write skips snapshot isolation (MariaDB
// 11 would otherwise fail it after a concurrent commit); without a caller's
// transaction it runs in a short one of its own.
async function nextSeq(companyId, kind, transaction) {
  const { sequelize } = models();
  const take = async (t) => {
    const replacements = { companyId, kind };
    await sequelize.query(
      'SET STATEMENT innodb_snapshot_isolation = 0 FOR '
      + 'INSERT INTO CompanyCounters (companyId, kind, seq) VALUES (:companyId, :kind, 1) ON DUPLICATE KEY UPDATE seq = seq + 1',
      { replacements, transaction: t },
    );
    const [row] = await sequelize.query(
      'SELECT seq FROM CompanyCounters WHERE companyId = :companyId AND kind = :kind',
      { replacements, type: QueryTypes.SELECT, transaction: t },
    );
    return row.seq;
  };
  return transaction ? take(transaction) : sequelize.transaction(take);
}

// The company's next ticket number.
async function nextNumber(companyId, transaction) {
  const { Company } = models();
  const company = await Company.findByPk(companyId, { attributes: ['id', 'code'], transaction });
  if (!company) throw new Error(`Company ${companyId} not found`);
  const seq = await nextSeq(companyId, 'ticket', transaction);
  return { seq, number: formatTicketNumber(company.code, seq) };
}

// Rewrites a ticket's task (and subtask) codes from one prefix to another.
async function renameTaskCodes(ticketId, from, to, transaction) {
  if (!from || from === to) return;
  const { sequelize } = models();
  await sequelize.query(
    `UPDATE Tasks SET code = CONCAT(:to, SUBSTRING(code, :cut))
     WHERE ticketId = :ticketId AND code LIKE :like`,
    {
      replacements: {
        to, cut: from.length + 1, ticketId, like: `${from.replace(/[\\%_]/g, '\\$&')}-%`,
      },
      transaction,
    },
  );
}

const withPrevious = (list, number) => {
  const prev = Array.isArray(list) ? list : [];
  return number && !prev.includes(number) ? [...prev, number] : prev;
};

// Ticket hooks.
async function beforeCreate(ticket, options) {
  if (ticket.number || !ticket.companyId) return;
  const { seq, number } = await nextNumber(ticket.companyId, options && options.transaction);
  ticket.companySeq = seq;
  ticket.number = number;
}

// A ticket moved to another company takes the next number there.
async function beforeUpdate(ticket, options) {
  if (!ticket.changed('companyId') || !ticket.companyId) return;
  const old = ticket.previous('number') || ticket.number;
  const { seq, number } = await nextNumber(ticket.companyId, options && options.transaction);
  ticket.companySeq = seq;
  ticket.number = number;
  ticket.previousNumbers = withPrevious(ticket.previousNumbers, old);
  await renameTaskCodes(ticket.id, old ? old : `#${legacyNumber(ticket.id)}`, number, options && options.transaction);
}

// Tickets moved in bulk (a contact changed company, a company merge): each
// takes the next number in the company it is now in.
async function renumberMoved(ticketIds, transaction) {
  if (!ticketIds || !ticketIds.length) return;
  const { Ticket } = models();
  const tickets = await Ticket.findAll({ where: { id: ticketIds }, order: [['id', 'ASC']], transaction });
  for (const ticket of tickets) {
    const old = ticket.number;
    const { seq, number } = await nextNumber(ticket.companyId, transaction); // eslint-disable-line no-await-in-loop
    await ticket.update( // eslint-disable-line no-await-in-loop
      { companySeq: seq, number, previousNumbers: withPrevious(ticket.previousNumbers, old) },
      { transaction, hooks: false },
    );
    await renameTaskCodes(ticket.id, old, number, transaction); // eslint-disable-line no-await-in-loop
  }
}

// A company's code changed: its tickets' numbers (and their tasks' codes)
// follow, and the old numbers stay findable.
async function followCompanyCode(companyId, oldCode, newCode, transaction) {
  if (!oldCode || oldCode === newCode) return;
  const { sequelize } = models();
  const run = (sql) => sequelize.query(sql, { replacements: { companyId, oldCode, newCode, cut: oldCode.length + 1 }, transaction });
  // Subtasks carry their ticket's id too.
  await run(`UPDATE Tasks k JOIN Tickets t ON t.id = k.ticketId
     SET k.code = CONCAT(:newCode, SUBSTRING(k.code, :cut))
     WHERE t.companyId = :companyId AND k.code LIKE CONCAT(t.number, '-%') AND t.number LIKE CONCAT(:oldCode, '-T%')`);
  await run(`UPDATE Tickets
     SET previousNumbers = JSON_ARRAY_APPEND(COALESCE(previousNumbers, JSON_ARRAY()), '$', number),
         number = CONCAT(:newCode, SUBSTRING(number, :cut))
     WHERE companyId = :companyId AND number LIKE CONCAT(:oldCode, '-T%')`);
}

// The number to show for a ticket known only by its id.
async function numberForId(id, transaction) {
  if (!id) return '';
  const { Ticket } = models();
  const ticket = await Ticket.findByPk(id, { attributes: ['id', 'number'], transaction });
  return ticketNumberOf(ticket || { id });
}

// A ticket by any number it has had: WC-T0042, an old WC-T0042 from before a
// move or a code change, or the five-digit number from before CN (its id).
async function findTicketIdByNumber(raw, { transaction } = {}) {
  const text = String(raw || '').trim().replace(/^#/, '');
  if (/^\d{1,15}$/.test(text)) {
    const id = parseInt(text, 10);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  const number = normalizeTicketNumber(text);
  if (!number) return null;
  const { Ticket, sequelize } = models();
  const current = await Ticket.findOne({ where: { number }, attributes: ['id'], transaction });
  if (current) return current.id;
  const rows = await sequelize.query(
    'SELECT id FROM Tickets WHERE JSON_CONTAINS(previousNumbers, JSON_QUOTE(:number)) ORDER BY id DESC LIMIT 1',
    { replacements: { number }, type: QueryTypes.SELECT, transaction },
  );
  return rows.length ? rows[0].id : null;
}

// For search: a WHERE clause matching a typed ticket number, or null.
function numberWhere(raw) {
  const number = normalizeTicketNumber(raw);
  if (!number) return null;
  const { sequelize } = models();
  return {
    [Op.or]: [
      { number },
      sequelize.literal(`JSON_CONTAINS(\`Ticket\`.\`previousNumbers\`, ${sequelize.escape(JSON.stringify(number))})`),
    ],
  };
}

module.exports = {
  legacyNumber,
  formatTicketNumber,
  ticketNumberOf,
  taskPrefixOf,
  normalizeTicketNumber,
  nextSeq,
  nextNumber,
  renameTaskCodes,
  beforeCreate,
  beforeUpdate,
  renumberMoved,
  followCompanyCode,
  findTicketIdByNumber,
  numberForId,
  numberWhere,
};
