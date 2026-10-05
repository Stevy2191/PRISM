// Project files: list, upload, download, delete.
const fs = require('fs');
const { Project, ProjectFile, User } = require('../../models');
const { ApiError, asyncHandler } = require('../../middleware/error');
const { logProjectActivity } = require('../../services/projectActivity');
const { canAccessProject } = require('../../services/permissionService');
const { userAttrs, resolveProjectTaskId } = require('./shared');

// ==================== Files ====================

// GET /projects/:id/files
const listFiles = asyncHandler(async (req, res) => {
  const project = await Project.findByPk(req.params.id);
  if (!project) throw new ApiError(404, 'Project not found', 'NOT_FOUND');
  if (!(await canAccessProject(req.user, project))) throw new ApiError(403, 'You do not have access to this project', 'FORBIDDEN');

  const files = await ProjectFile.findAll({
    where: { projectId: project.id },
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
  await logProjectActivity(project.id, req.user.id, 'file_uploaded', { fileId: file.id, filename: file.filename });

  const fresh = await ProjectFile.findByPk(file.id, { include: [{ model: User, as: 'uploadedByUser', attributes: userAttrs }] });
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
  await file.destroy();
  fs.rm(file.filepath, { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = {
  listFiles,
  uploadFile,
  downloadFile,
  removeFile,
};
