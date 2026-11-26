// Stripe (Phase 3, step 3): the only code that talks to Stripe. Card and
// bank details never reach PRISM: customers pay on Stripe Checkout, and
// Stripe tells PRISM by a signed webhook. The secret key and the webhook
// signing secret are stored encrypted (tokenCrypto), set only by Owners,
// and never returned by any API. Tests swap the client for a fake.
const Stripe = require('stripe');
const { SystemSettings } = require('../../models');
const { ApiError } = require('../../middleware/error');
const { encryptToken, decryptToken } = require('../../utils/tokenCrypto');

const KEYS = {
  secretKey: 'money.stripeSecretKey',
  webhookSecret: 'money.stripeWebhookSecret',
  publishableKey: 'money.stripePublishableKey',
};
const SECRET_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,200}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,200}$/;
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9]{10,200}$/;

let testClient = null;
// Tests only: a fake with the same shape as the Stripe calls PRISM makes.
function setClientForTests(client) { testClient = client; }

async function stored(key) {
  const row = await SystemSettings.findByPk(key, { attributes: ['value'] });
  return row && row.value ? row.value : null;
}
async function secret(key) {
  const value = await stored(key);
  if (!value) return null;
  try { return decryptToken(value); } catch { return null; }
}

// { stripeConfigured, stripeWebhookConfigured, stripePublishableKey } — never a secret.
async function status() {
  const [key, hook, pk] = await Promise.all([stored(KEYS.secretKey), stored(KEYS.webhookSecret), stored(KEYS.publishableKey)]);
  return { stripeConfigured: !!key, stripeWebhookConfigured: !!hook, stripePublishableKey: pk };
}

// body: { secretKey?, webhookSecret?, publishableKey? } ('' or null removes one)
async function saveKeys(body, userId) {
  const changes = {};
  const take = (name, pattern, label, encrypt) => {
    if (body[name] === undefined) return;
    if (body[name] === null || body[name] === '') { changes[KEYS[name]] = null; return; }
    const value = String(body[name]).trim();
    if (!pattern.test(value)) throw new ApiError(400, `That isn't a Stripe ${label}`, 'VALIDATION_ERROR');
    changes[KEYS[name]] = encrypt ? encryptToken(value) : value;
  };
  take('secretKey', SECRET_KEY, 'secret key (sk_live_… or sk_test_…)', true);
  take('webhookSecret', WEBHOOK_SECRET, 'webhook signing secret (whsec_…)', true);
  take('publishableKey', PUBLISHABLE_KEY, 'publishable key (pk_live_… or pk_test_…)', false);
  for (const [key, value] of Object.entries(changes)) {
    // eslint-disable-next-line no-await-in-loop
    await SystemSettings.upsert({ key, value, updatedById: userId || null });
  }
  return Object.keys(changes).map((k) => Object.keys(KEYS).find((n) => KEYS[n] === k));
}

let cached = { key: null, client: null };
async function client() {
  if (testClient) return testClient;
  const key = await secret(KEYS.secretKey);
  if (!key) throw new ApiError(409, 'Online payment isn\'t set up yet', 'STRIPE_NOT_SET');
  if (cached.key !== key) cached = { key, client: new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 }) };
  return cached.client;
}

// The event, if the signature is Stripe's; else throws 400.
const verifier = new Stripe('sk_test_signature_check_only');
async function verifiedEvent(rawBody, signature) {
  const hookSecret = await secret(KEYS.webhookSecret);
  if (!hookSecret || !rawBody || !signature) throw new ApiError(400, 'Webhook not accepted', 'BAD_SIGNATURE');
  try {
    return verifier.webhooks.constructEvent(rawBody, signature, hookSecret);
  } catch {
    throw new ApiError(400, 'Webhook not accepted', 'BAD_SIGNATURE');
  }
}

module.exports = {
  setClientForTests, client, status, saveKeys, verifiedEvent,
};
