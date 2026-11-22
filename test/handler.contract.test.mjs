// Handler CALL-SITE contract tests (#39 follow-up). routing.test.mjs locks in
// what buildEmail returns, and classify.test.mjs locks classify() parity — but
// neither ever invokes handler() in api/intake.js. A helper-only guard is blind
// to its call site: if a later refactor drops the handler's __GMAIL_ACTION__
// emission (or the recoverable record log), every existing test stays green
// while the original #39 bug — public submissions silently un-routed — comes
// back. These tests run the real handler with a mock req/res, capture its
// console output, and assert the terminal side-effects actually happen, in
// lockstep with what the CLI path (intake.js main) emits.

import handler from '../api/intake.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

const FOUNDER = process.env.FOUNDER_EMAIL || 'morrisstephon51@gmail.com';

// Force the no-Supabase branch so the handler stays offline and must emit the
// recoverable submission log instead of inserting.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

function mockRes() {
  const res = {
    statusCode: null,
    jsonBody: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    end() { return this; },
  };
  return res;
}

// Run handler() with console.log/console.error captured, then restore.
async function runHandler(body) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  const res = mockRes();
  try {
    await handler({ method: 'POST', body }, res);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  // The __GMAIL_ACTION__ envelope is the marker line followed by the JSON line,
  // exactly as the CLI emits it.
  const markerIdx = lines.findIndex(l => l.includes('__GMAIL_ACTION__'));
  const action = markerIdx !== -1 && lines[markerIdx + 1]
    ? JSON.parse(lines[markerIdx + 1])
    : null;
  const recordLine = lines.find(l => l.includes('community_intake submission'));
  const record = recordLine ? JSON.parse(recordLine.slice(recordLine.indexOf('{'))) : null;
  return { res, lines, action, record };
}

console.log('\n[handler] api/intake.js call-site contract');

// Partner: the heart of #39 — the founder alert must actually be EMITTED by the
// web path, not merely constructible by the helper.
const partner = await runHandler({
  name: 'Priya', email: 'priya@techcorp.com', zip: '94105',
  how_heard: 'LinkedIn', interest_description: 'Our organization would love to sponsor and collaborate.',
});
check('partner: handler emits a __GMAIL_ACTION__ envelope', partner.action !== null);
check('partner: action is send_email', partner.action?.action === 'send_email', `got ${partner.action?.action}`);
check('partner: routed to the FOUNDER, not the submitter', partner.action?.to === FOUNDER, `got ${partner.action?.to}`);
check('partner: responds 200 success', partner.res.statusCode === 200 && partner.res.jsonBody?.success === true);
check('partner: response classification is partner', partner.res.jsonBody?.classification === 'partner', `got ${partner.res.jsonBody?.classification}`);

// Learner: welcome email routed back to the submitter.
const learner = await runHandler({
  name: 'Jordan', email: 'jordan@example.com',
  interest_description: 'I want to learn how to use AI for my small business and grow my skills.',
});
check('learner: handler emits a __GMAIL_ACTION__ envelope', learner.action !== null);
check('learner: routed to the submitter', learner.action?.to === 'jordan@example.com', `got ${learner.action?.to}`);

// #12 at the call site: the recoverable no-Supabase record log must carry the
// full column set including reasoning — not just be constructible in classify().
check('record log present when Supabase is unconfigured', learner.record !== null);
check('record carries classification', learner.record?.classification === 'learner', `got ${learner.record?.classification}`);
check('record carries non-empty reasoning (#12)', typeof learner.record?.reasoning === 'string' && learner.record.reasoning.length > 0);
check('record status is routed', learner.record?.status === 'routed', `got ${learner.record?.status}`);

// Invalid email: reject AND stay silent — no routing action may be emitted for
// a payload the handler refused.
const bad = await runHandler({ name: 'X', email: 'not-an-email', interest_description: 'hello' });
check('invalid email: responds 400', bad.res.statusCode === 400, `got ${bad.res.statusCode}`);
check('invalid email: NO routing action emitted', bad.action === null);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
