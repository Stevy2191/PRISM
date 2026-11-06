const { resolvePlaybook, offeredFor, deviceContext } = require('../../src/services/playbooks/resolve');

// Sub-project PB, task 4: which forms a playbook adds, first match per device.

const MAC = 3;
const IPHONE = 4;
const LAPTOP = 5;
const TABLET = 6;
const MDM_A = 11;
const MDM_B = 12;

const asset = (id, fields) => ({
  id, companyId: 1, categoryId: LAPTOP, isManaged: false, mdmId: null, hasCellular: false, ...fields,
});
const mac = asset(1, { categoryId: MAC, isManaged: true, mdmId: MDM_A, device: { revokedAt: null } });
const iphone = asset(2, { categoryId: IPHONE, isManaged: true, mdmId: MDM_B, hasCellular: true });
const laptop = asset(3, {});
const tablet = asset(4, { categoryId: TABLET }); // no MDM set

// Like the owner's termination: account form once; Apple check-in for
// managed Apple devices; Device check-in for anything not managed.
const termination = {
  companyIds: null,
  blocks: [
    { formId: 100, applies: 'once', limits: {} },
    { formId: 200, applies: 'person_devices', limits: { categoryIds: [MAC, IPHONE, TABLET], managed: true } },
    { formId: 300, applies: 'person_devices', limits: { managed: false, categoryIds: [LAPTOP] } },
  ],
};

it('once-blocks once; each device its first matching block; the rest not covered', () => {
  const { forms, uncovered } = resolvePlaybook(termination, { personDevices: [mac, iphone, laptop, tablet] });
  expect(forms).toEqual([
    { blockIndex: 0, formId: 100, assetId: null },
    { blockIndex: 1, formId: 200, assetId: 1 },
    { blockIndex: 1, formId: 200, assetId: 2 },
    { blockIndex: 2, formId: 300, assetId: 3 },
  ]);
  expect(uncovered.map((a) => a.id)).toEqual([4]);
});

it('first match wins: a catch-all after a narrower block only takes what is left', () => {
  const p = {
    blocks: [
      { formId: 200, applies: 'person_devices', limits: { mdmIds: [MDM_A] } },
      { formId: 300, applies: 'person_devices', limits: {} },
    ],
  };
  const { forms, uncovered } = resolvePlaybook(p, { personDevices: [mac, iphone] });
  expect(forms.map((f) => [f.assetId, f.formId])).toEqual([[1, 200], [2, 300]]);
  expect(uncovered).toEqual([]);
});

it('person and ticket devices take only their own kind of block; a device in both counts once', () => {
  const p = {
    blocks: [
      { formId: 200, applies: 'ticket_devices', limits: {} },
      { formId: 300, applies: 'person_devices', limits: {} },
    ],
  };
  const { forms } = resolvePlaybook(p, { personDevices: [laptop, mac], ticketDevices: [mac, iphone] });
  expect(forms.map((f) => [f.assetId, f.formId]).sort()).toEqual([[1, 200], [2, 200], [3, 300]]);
  // No ticket_devices block: ticket devices are ignored, not "uncovered".
  const only = resolvePlaybook({ blocks: [{ formId: 300, applies: 'person_devices', limits: {} }] }, { ticketDevices: [iphone] });
  expect(only).toEqual({ forms: [], uncovered: [] });
});

it('limits on cellular and the agent', () => {
  const p = {
    blocks: [
      { formId: 1, applies: 'person_devices', limits: { hasCellular: true } },
      { formId: 2, applies: 'person_devices', limits: { hasAgent: true } },
    ],
  };
  const { forms, uncovered } = resolvePlaybook(p, { personDevices: [mac, iphone, laptop] });
  expect(forms.map((f) => [f.assetId, f.formId])).toEqual([[1, 2], [2, 1]]);
  expect(uncovered.map((a) => a.id)).toEqual([3]);
});

it('a revoked agent is no agent; offered for every company unless listed', () => {
  expect(deviceContext({ ...mac, device: { revokedAt: new Date() } }).hasAgent).toBe(false);
  expect(deviceContext(mac).hasAgent).toBe(true);
  expect(offeredFor({ companyIds: null }, 7)).toBe(true);
  expect(offeredFor({ companyIds: [1, 2] }, 7)).toBe(false);
  expect(offeredFor({ companyIds: [1, 7] }, 7)).toBe(true);
});
