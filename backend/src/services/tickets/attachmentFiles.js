// Ticket attachment files live in UPLOAD_ROOT/<ticketId>/<filename>. When a
// merge or split moves attachment rows to another ticket the files move too:
// copied before the database commit, originals removed after it, and the
// copies removed if the transaction rolls back. Stored filenames are
// generated and unique, so nothing is renamed.
const fs = require('fs');
const path = require('path');
const { UPLOAD_ROOT } = require('../../middleware/upload');

const ROOT = path.resolve(UPLOAD_ROOT);

// The on-disk path for a stored attachment, refusing anything that would
// land outside UPLOAD_ROOT (the name is generated, but never trusted).
function attachmentPath(ticketId, filename) {
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Bad ticket id for an attachment path');
  const full = path.resolve(ROOT, String(id), path.basename(String(filename)));
  if (!full.startsWith(ROOT + path.sep)) throw new Error('Attachment path escapes the upload folder');
  return full;
}

// Copies each row's file into toTicketId's folder. Returns
// { copied: [paths written], originals: [paths copied from] }. A row whose
// file is already missing is skipped (the row still moves).
async function copyToTicket(rows, toTicketId) {
  const copied = [];
  const originals = [];
  if (!rows.length) return { copied, originals };
  await fs.promises.mkdir(path.resolve(ROOT, String(Number(toTicketId))), { recursive: true });
  try {
    for (const row of rows) {
      const from = attachmentPath(row.ticketId, row.filename);
      const to = attachmentPath(toTicketId, row.filename);
      // eslint-disable-next-line no-await-in-loop
      const present = await fs.promises.access(from).then(() => true, () => false);
      if (!present) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      copied.push(to);
      originals.push(from);
    }
  } catch (err) {
    await removeFiles(copied);
    throw err;
  }
  return { copied, originals };
}

// Best-effort removal; a file already gone is fine.
async function removeFiles(paths) {
  await Promise.all(paths.map((p) => fs.promises.rm(p, { force: true }).catch((err) => {
    console.error('[attachments] could not remove', p, err.message);
  })));
}

module.exports = { attachmentPath, copyToTicket, removeFiles };
