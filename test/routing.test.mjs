// Routing-action tests (#39). The web handler (api/intake.js) previously
// classified and logged but never produced a routing action, so every public
// submission was silently un-routed. buildEmail is now the single source of the
// routing decision, shared by the CLI and the web path — these assertions lock
// in WHERE each class routes so the two entry points cannot drift on it.

import { buildEmail } from '../lib/email.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

const FOUNDER = process.env.FOUNDER_EMAIL || 'morrisstephon51@gmail.com';

console.log('\n[routing] buildEmail()');

const learner = buildEmail('learner', { name: 'Jordan', email: 'jordan@example.com' });
check('learner routes to the submitter', learner.to === 'jordan@example.com', `got ${learner.to}`);
check('learner subject is a welcome', /welcome/i.test(learner.subject), learner.subject);
check('learner body is non-empty', typeof learner.body === 'string' && learner.body.length > 0);

// The whole point of #39: a partner inquiry is a FOUNDER alert, not a reply to
// the submitter. If this ever routes back to the submitter, the founder never
// hears about the partner.
const partner = buildEmail('partner', {
  name: 'Priya', email: 'priya@techcorp.com', zip: '94105',
  how_heard: 'LinkedIn', interest_description: 'we would love to sponsor',
});
check('partner routes to the FOUNDER, not the submitter', partner.to === FOUNDER, `got ${partner.to}`);
check('partner subject flags a partner inquiry', /partner/i.test(partner.subject), partner.subject);
check('partner alert carries the submitter email', partner.body.includes('priya@techcorp.com'));

const volunteer = buildEmail('volunteer', { name: 'Marcus', email: 'marcus@example.com' });
check('volunteer routes to the submitter', volunteer.to === 'marcus@example.com', `got ${volunteer.to}`);
check('volunteer body links the volunteer form', /volunteer/i.test(volunteer.body), volunteer.body.slice(0, 60));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
