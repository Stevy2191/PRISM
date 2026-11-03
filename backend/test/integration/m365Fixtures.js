// Shared by the Microsoft 365 suites (7b): ids, a sign-in profile, and the
// browser round trip start → fake Microsoft → callback.
const TENANT = '11111111-2222-3333-4444-555555555555';
const GROUP = 'a0000000-0000-0000-0000-000000000001';
const uid = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const person = (n, extra = {}) => ({
  tid: TENANT, oid: uid(n), email: `person${n}@tenant.test`, name: `Person ${n}`, given_name: 'Person', family_name: String(n), ...extra,
});

// Returns the callback's response (a redirect to /portal, or to the sign-in
// page with ?refused=) and the callback path.
async function microsoftSignIn(ms, agent, profile) {
  ms.nextSignIn = profile;
  const start = await agent.get('/api/v1/portal/auth/microsoft/start');
  if (start.status !== 302) throw new Error(`start → ${start.status}`);
  const authorize = await fetch(start.headers.location, { redirect: 'manual' });
  if (authorize.status !== 302) throw new Error(`authorize → ${authorize.status}`);
  const back = new URL(authorize.headers.get('location'));
  const callbackPath = back.pathname + back.search;
  return { res: await agent.get(callbackPath), callbackPath };
}

module.exports = {
  TENANT, GROUP, uid, person, microsoftSignIn,
};
