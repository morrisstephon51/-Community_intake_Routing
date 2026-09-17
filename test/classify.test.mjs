// Consolidated classifier tests — covers the fixes folded into this branch:
//   #3 substring misroute → word-boundary matching
//   #5 learner default reported near-certain → neutral 0.5 confidence
//   #7 how_heard attribution pollutes intent scoring → intent field only
//   #9 single-keyword partner/volunteer downgraded to learner → evidence denominator
//   #12 web path drops `reasoning` → return-shape parity between the two copies
//   #22 service-seeking nouns misroute learners to volunteer inbox
//   #24 professional-context verb `serve` misroutes job-describing learners to volunteer inbox
// Runs the SAME cases against both the CLI module (intake.js) and the API
// handler module (api/intake.js) so the two copies of classify() cannot drift.

import { classify as classifyCli } from '../intake.js';
import { classify as classifyApi } from '../api/intake.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

for (const [impl, classify] of [['cli', classifyCli], ['api', classifyApi]]) {
  console.log(`\n[${impl}] classify()`);

  // #3 — short keyword must not match as a substring of an innocent word.
  const funda = classify({ interest_description: 'I want to master the fundamentals of AI', how_heard: '' });
  check('#3 "fundamentals" does NOT trigger partner("fund")', funda.label === 'learner', `got ${funda.label}`);
  const teacher = classify({ interest_description: 'I am a teacher who wants to learn AI', how_heard: '' });
  check('#3 "teacher" does NOT trigger volunteer("teach")', teacher.label === 'learner', `got ${teacher.label}`);
  // ...but the real word still matches.
  // #22 — after removing service-seeking nouns, "teach"/"mentor" no longer
  // route to volunteer. "I want to teach and mentor students" now correctly
  // falls back to the learner default (false-negative for volunteer is safer
  // than misrouting a genuine learner seeking instruction).
  const teach = classify({ interest_description: 'I want to teach and mentor students', how_heard: '' });
  check('#22 "teach"/"mentor" no longer misroutes to volunteer (falls back to learner)', teach.label === 'learner', `got ${teach.label}`);

  // #22 — learners SEEKING instruction must not hit volunteer keywords.
  const needMentor = classify({ interest_description: 'I need a mentor to help me learn AI', how_heard: '' });
  check('#22 "I need a mentor" does NOT misroute to volunteer', needMentor.label === 'learner', `got ${needMentor.label}`);
  const teachMe = classify({ interest_description: 'Teach me how to use AI for my church', how_heard: '' });
  check('#22 "Teach me" does NOT misroute to volunteer', teachMe.label === 'learner', `got ${teachMe.label}`);
  const seekCoach = classify({ interest_description: "I'm looking for coaching on AI tools", how_heard: '' });
  check('#22 "looking for coaching" does NOT misroute to volunteer', seekCoach.label === 'learner', `got ${seekCoach.label}`);

  // #24 — professional-context verb `serve` must not misroute job-describing
  // learners to the volunteer inbox. Healthcare workers, social workers, and
  // educators describe their roles with `serve`; they are NOT offering to
  // volunteer at The Plug AI.
  const serveHealthcare = classify({ interest_description: 'I serve seniors at a nursing home and want AI tools', how_heard: '' });
  check('#24 "I serve seniors" (healthcare context) does NOT misroute to volunteer', serveHealthcare.label === 'learner', `got ${serveHealthcare.label}`);
  const serveProfessional = classify({ interest_description: 'I serve my community through public health work and want to learn AI', how_heard: '' });
  check('#24 "I serve my community" (professional context) does NOT misroute to volunteer', serveProfessional.label === 'learner', `got ${serveProfessional.label}`);
  // ...but genuine volunteer intent still routes correctly via other signals.
  const serveVolunteer = classify({ interest_description: 'I want to volunteer and serve the community', how_heard: '' });
  check('#24 genuine volunteer with "volunteer" keyword still routes volunteer', serveVolunteer.label === 'volunteer', `got ${serveVolunteer.label}`);

  // #7 — how_heard is attribution, not intent; it must not drive the label.
  const heard = classify({ interest_description: 'I want to learn AI to grow my skills', how_heard: 'A company partner referred me' });
  check('#7 how_heard "company partner" ignored → learner', heard.label === 'learner', `got ${heard.label}`);

  // #5 — a signal-less learner default is neutral, not near-certain.
  const bare = classify({ interest_description: 'just hoping to learn something new', how_heard: '' });
  check('#5 learner default label', bare.label === 'learner', `got ${bare.label}`);
  check('#5 learner default confidence is neutral 0.5', bare.confidence === 0.5, `got ${bare.confidence}`);

  // #9 — a genuine single-keyword partner/volunteer must route, not be downgraded.
  const sponsor = classify({ interest_description: 'We would love to sponsor', how_heard: '' });
  check('#9 single-keyword "sponsor" routes to partner', sponsor.label === 'partner', `got ${sponsor.label}`);
  check('#9 single-keyword partner clears 0.7 threshold', sponsor.confidence >= 0.7, `got ${sponsor.confidence}`);
  const vol = classify({ interest_description: 'I want to volunteer', how_heard: '' });
  check('#9 single-keyword "volunteer" routes to volunteer', vol.label === 'volunteer', `got ${vol.label}`);
  check('#9 single-keyword volunteer clears 0.7 threshold', vol.confidence >= 0.7, `got ${vol.confidence}`);

  // Regression guard: strong multi-keyword partner still classifies confidently.
  const strong = classify({ interest_description: 'Our organization wants to collaborate and sponsor events', how_heard: '' });
  check('multi-keyword partner still routes partner', strong.label === 'partner', `got ${strong.label}`);

  // #9 follow-up — an affiliation noun ("business"/"company") describes the
  // inquirer's context, not partnership intent. A clear learner who owns one
  // must NOT be misrouted to the founder inbox (they would never get a welcome
  // email). This was the documented regression from #9's evidence denominator.
  const bizLearner = classify({ interest_description: 'I want to learn how to use AI for my small business and grow my skills.', how_heard: 'Instagram' });
  check('affiliation noun "business" does NOT misroute a clear learner', bizLearner.label === 'learner', `got ${bizLearner.label}`);
  const companyLearner = classify({ interest_description: 'Hoping to learn how to use AI at my company', how_heard: '' });
  check('affiliation noun "company" does NOT misroute a learner', companyLearner.label === 'learner', `got ${companyLearner.label}`);

  // #12 — every classify() return must carry a non-empty `reasoning` string.
  // The web copy previously returned only { label, confidence }, so it wrote
  // NULL reasoning to community_intake for every real submission.
  check('#12 reasoning present on a routed result', typeof sponsor.reasoning === 'string' && sponsor.reasoning.length > 0, `got ${JSON.stringify(sponsor.reasoning)}`);
  check('#12 reasoning present on the learner default', typeof bare.reasoning === 'string' && bare.reasoning.length > 0, `got ${JSON.stringify(bare.reasoning)}`);
}

// #12 — cross-impl reasoning parity. Both classify() copies write to the SAME
// community_intake.reasoning column, so identical input must yield identical
// reasoning — not just identical label/confidence. The old drift guard checked
// only label+confidence, so the web path silently omitting reasoning slipped
// through the very test that exists to stop the two copies from drifting.
console.log('\n[parity] cli vs api reasoning');
const parityCases = [
  'I want to master the fundamentals of AI',
  'We would love to sponsor',
  'I want to volunteer',
  'Our organization wants to collaborate and sponsor events',
  'just hoping to learn something new',
  'We want to invest and fund community programs',
  'I need a mentor to help me learn AI',
  'Teach me how to use AI for my church',
  'I serve seniors at a nursing home and want AI tools',
];
for (const desc of parityCases) {
  const a = classifyCli({ interest_description: desc, how_heard: '' });
  const b = classifyApi({ interest_description: desc, how_heard: '' });
  const label = desc.slice(0, 34);
  check(`reasoning present in both — "${label}"`,
    typeof a.reasoning === 'string' && a.reasoning.length > 0 &&
    typeof b.reasoning === 'string' && b.reasoning.length > 0,
    `\n    cli=${JSON.stringify(a.reasoning)}\n    api=${JSON.stringify(b.reasoning)}`);
  check(`reasoning parity — "${label}"`, a.reasoning === b.reasoning,
    `\n    cli=${JSON.stringify(a.reasoning)}\n    api=${JSON.stringify(b.reasoning)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
