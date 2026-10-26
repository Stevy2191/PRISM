// Project files: list, upload, download, delete.
const fs = require('fs');
const { Project, ProjectFile, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { writeAudit } = require('../../middleware/audit');
const { logProjectActivity } = require('../../services/projectActivity');
const { canAccessProject, canEditProject, canModerateProjectContent } = require('../../services/permissionService');
const { userAttrs, resolveProjectTaskId } = require('./shared');

// The stored path is the server's business, never the client's.
const fileAttrs = { exclude: ['filepath'] };

// ==================== Files ====================

// GET /projects/:id/files
const listFiles = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const files = await ProjectFile.findAll({
    where: { projectId: project.id },
    attributes: fileAttrs,
    include: [{ model: User, as: 'uploadedByUser', attributes: userAttrs }],
    order: [['createdAt', 'DESC']],
  });
  res.json({ files });
});

// POST /projects/:id/files
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded (field name must be "file")', 'NO_FILE');
  const project = await Project.findByPk(req.params.id);
  if (!project) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  }
  if (!(await canAccessProject(req.user, project))) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  // Adding files is editing: helpers and view-only staff can't.
  if (!(await canEditProject(req.user, project))) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw new ApiError(403, 'You do not have permission to edit this project', 'FORBIDDEN');
  }

  const { taskId } = req.body || {};
  let resolvedTaskId;
  try {
    resolvedTaskId = await resolveProjectTaskId(project, taskId);
  } catch (err) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw err;
  }
  const file = await ProjectFile.create({
    projectId: project.id,
    taskId: resolvedTaskId,
    filename: req.file.originalname,
    filepath: req.file.path,
    filesize: req.file.size,
    uploadedBy: req.user.id,
  });
  await writeAudit(req, 'project_file.upload', 'ProjectFile', file.id, { projectId: project.id, filename: file.filename });
  await logProjectActivity(project.id, req.user.id, 'file_uploaded', { fileId: file.id, filename: file.filename });

  const fresh = await ProjectFile.findByPk(file.id, {
    attributes: fileAttrs, include: [{ model: User, as: 'uploadedByUser', attributes: userAttrs }],
  });
  res.status(201).json({ file: fresh });
});

// GET /projects/:id/files/:fileId/download
const downloadFile = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const file = await ProjectFile.findOne({ where: { id: req.params.fileId, projectId: req.params.id } });
  if (!file) throw new ApiError(404, 'File not found', 'NOT_FOUND');
  res.download(file.filepath, file.filename);
});

// DELETE /projects/:id/files/:fileId
const removeFile = asyncHandler(async (req, res) => {
  const file = await ProjectFile.findOne({ where: { id: req.params.fileId, projectId: req.params.id } });
  if (!file) throw new ApiError(404, 'File not found', 'NOT_FOUND');
  const project = await Project.findByPk(req.params.id);
  if (!project || !(await canAccessProject(req.user, project))) {
    throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');
  }
  // Q17: the uploader, or a project moderator (edit_all, or edit_department
  // for a project owned by or for the user's department).
  if (file.uploadedBy !== req.user.id && !(await canModerateProjectContent(req.user, project))) {
    throw new ApiError(403, 'Only the uploader or a project moderator can delete this file', 'FORBIDDEN');
  }
  await file.destroy();
  fs.rm(file.filepath, { force: true }, () => {});
  await writeAudit(req, 'project_file.delete', 'ProjectFile', file.id, { projectId: project.id, filename: file.filename });
  res.json({ ok: true });
});

module.exports = {
  listFiles,
  uploadFile,
  downloadFile,
  removeFile,
};
