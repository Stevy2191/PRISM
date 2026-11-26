// A stand-in for the Stripe client (Phase 3 payments): records what PRISM
// asks for and answers like Stripe would. Webhook signatures are real
// (Stripe's own library signs the test payloads), so verification is tested.
const Stripe = require('stripe');

const signer = new Stripe('sk_test_signer_only');

function makeFakeStripe() {
  const fake = {
    sessions: [],
    refundsMade: [],
    // payment intent id → { fee (cents), refunds: [{ id, amount, status }] }
    intents: {},
    checkout: {
      sessions: {
        create: async (params) => {
          const id = `cs_test_${fake.sessions.length + 1}`;
          fake.sessions.push({ id, ...params });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
      },
    },
    paymentIntents: {
      retrieve: async (id) => ({
        id,
        latest_charge: { id: `ch_${id}`, balance_transaction: { fee: (fake.intents[id] || {}).fee || 0 } },
      }),
    },
    refunds: {
      create: async (params) => {
        const refund = { id: `re_test_${fake.refundsMade.length + 1}`, amount: params.amount, status: 'succeeded', payment_intent: params.payment_intent };
        fake.refundsMade.push(refund);
        const intent = fake.intents[params.payment_intent] || (fake.intents[params.payment_intent] = {});
        (intent.refunds || (intent.refunds = [])).push(refund);
        return refund;
      },
      list: async ({ payment_intent: pi }) => ({ data: ((fake.intents[pi] || {}).refunds || []), has_more: false }),
    },
  };
  return fake;
}

// A signed webhook request body and header for `event`.
function signed(event, secret) {
  const payload = JSON.stringify(event);
  return { payload, header: signer.webhooks.generateTestHeaderString({ payload, secret }) };
}

module.exports = { makeFakeStripe, signed };
