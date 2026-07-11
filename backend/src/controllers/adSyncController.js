const { AdSyncLog, AdGroupMapping, Department, SystemSettings } = require('../models');
const { ApiError, asyncHandler } = require('../middleware/error');
const { runAdContactSync } = require('../services/adContactSync');
const { isConfigured } = require('../config/ldap');

const SETTING_ENABLED = 'adsync.enabled';
const SETTING_INTERVAL = 'adsync.intervalHours'; // 1 | 4 | 8 | 24 | 0 (0 = manual only)
const VALID_INTERVALS = [1, 4, 8, 24, 0];

async function getSetting(key, fallback) {
  const row = await SystemSettings.findOne({ where: { key } });
  return row ? row.value : fallback;
}

// GET /ad-sync/settings
const getSettings = asyncHandler(async (req, res) => {
  const [enabledRaw, intervalRaw, lastLog] = await Promise.all([
    getSetting(SETTING_ENABLED, 'false'),
    getSetting(SETTING_INTERVAL, '24'),
    AdSyncLog.findOne({ order: [['startedAt', 'DESC']] }),
  ]);
  res.json({
    enabled: enabledRaw === 'true',
    intervalHours: Number(intervalRaw),
    ldapConfigured: await isConfigured(),
    lastSync: lastLog ? {
      status: lastLog.status,
      startedAt: lastLog.startedAt,
      completedAt: lastLog.completedAt,
    } : null,
  });
});

// PUT /ad-sync/settings { enabled, intervalHours }
const saveSettings = asyncHandler(async (req, res) => {
  const { enabled, intervalHours } = req.body || {};
  if (intervalHours !== undefined && !VALID_INTERVALS.includes(Number(intervalHours))) {
    throw new ApiError(400, 'Invalid sync interval', 'VALIDATION_ERROR');
  }
  if (enabled !== undefined) {
    await SystemSettings.upsert({ key: SETTING_ENABLED, value: String(!!enabled), updatedById: req.user.id });
  }
  if (intervalHours !== undefined) {
    await SystemSettings.upsert({ key: SETTING_INTERVAL, value: String(Number(intervalHours)), updatedById: req.user.id });
  }
  res.json({ ok: true });
});

// POST /ad-sync/run — manual trigger; runs inline (no job queue in this app)
// and returns once complete, so the frontend should show a loading state.
const runNow = asyncHandler(async (req, res) => {
  if (!(await isConfigured())) throw new ApiError(400, 'LDAP is not configured (see Settings -> General Settings)', 'LDAP_NOT_CONFIGURED');
  const log = await runAdContactSync('manual');
  res.json({ log });
});

// GET /ad-sync/logs — last 20 runs
const listLogs = asyncHandler(async (req, res) => {
  const logs = await AdSyncLog.findAll({ order: [['startedAt', 'DESC']], limit: 20 });
  res.json({ logs });
});

// GET /ad-sync/group-mappings
const listMappings = asyncHandler(async (req, res) => {
  const mappings = await AdGroupMapping.findAll({
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    order: [['createdAt', 'ASC']],
  });
  res.json({ mappings });
});

// POST /ad-sync/group-mappings { adGroupName, departmentId }
const createMapping = asyncHandler(async (req, res) => {
  const { adGroupName, departmentId } = req.body || {};
  if (!adGroupName || !adGroupName.trim()) throw new ApiError(400, 'AD group name is required', 'VALIDATION_ERROR');
  if (!departmentId) throw new ApiError(400, 'Department is required', 'VALIDATION_ERROR');
  const dept = await Department.findByPk(departmentId);
  if (!dept) throw new ApiError(404, 'Department not found', 'NOT_FOUND');

  const mapping = await AdGroupMapping.create({ adGroupName: adGroupName.trim(), departmentId });
  res.status(201).json({ mapping: { ...mapping.toJSON(), department: { id: dept.id, name: dept.name } } });
});

// DELETE /ad-sync/group-mappings/:id
const removeMapping = asyncHandler(async (req, res) => {
  const mapping = await AdGroupMapping.findByPk(req.params.id);
  if (!mapping) throw new ApiError(404, 'Mapping not found', 'NOT_FOUND');
  await mapping.destroy();
  res.json({ ok: true });
});

module.exports = { getSettings, saveSettings, runNow, listLogs, listMappings, createMapping, removeMapping };
