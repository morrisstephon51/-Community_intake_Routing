// Consolidated classifier tests — covers the fixes folded into this branch:
//   #3 substring misroute → word-boundary matching
//   #5 learner default reported near-certain → neutral 0.5 confidence
//   #7 how_heard attribution pollutes intent scoring → intent field only
//   #9 single-keyword partner/volunteer downgraded to learner → evidence denominator
//   #12 web path drops `reasoning` → return-shape parity between the two copies
//   #14 affiliation nouns brand/corporate misroute learners → dropped from partner keywords
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
  const teach = classify({ interest_description: 'I want to teach and mentor students', how_heard: '' });
  check('#3 real "teach"/"mentor" still routes volunteer', teach.label === 'volunteer', `got ${teach.label}`);

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

  // #14 — `brand` and `corporate` are affiliation/context nouns, not partnership
  // intent — the same class as the `business`/`company`/`enterprise`/`agency`
  // that #9 removed, but left behind in the keyword list. A learner growing a
  // personal brand or holding a corporate job must NOT be misrouted to the
  // founder inbox (the learner path is the only one that emits a welcome email).
  const brandLearner = classify({ interest_description: 'I want to learn AI to grow my personal brand', how_heard: '' });
  check('#14 "personal brand" does NOT misroute a learner to partner', brandLearner.label === 'learner', `got ${brandLearner.label}`);
  const corpLearner = classify({ interest_description: 'I have a corporate job and I want to learn AI', how_heard: '' });
  check('#14 "corporate job" does NOT misroute a learner to partner', corpLearner.label === 'learner', `got ${corpLearner.label}`);
  // ...but a genuine partner who merely mentions a brand still routes on real intent verbs.
  const brandPartner = classify({ interest_description: 'Our brand would love to collaborate and sponsor your events', how_heard: '' });
  check('#14 real partner intent ("collaborate"/"sponsor") still routes partner', brandPartner.label === 'partner', `got ${brandPartner.label}`);

  // #16 — `organization` / `organisation` are affiliation/context nouns, same
  // class as #9 (business/company/enterprise/agency) and #14 (brand/corporate).
  // Faith-community and community-org members routinely self-describe via "our
  // organization" and were being misrouted to the founder inbox (no welcome email).
  const orgLearner = classify({ interest_description: "I'm with a community organization and want to learn AI for my nonprofit", how_heard: '' });
  check('#16 "community organization" does NOT misroute a learner to partner', orgLearner.label === 'learner', `got ${orgLearner.label}`);
  const faithLearner = classify({ interest_description: 'Our faith organization wants to bring AI skills to our members', how_heard: '' });
  check('#16 "faith organization" does NOT misroute a learner to partner', faithLearner.label === 'learner', `got ${faithLearner.label}`);
  const orgSpellingLearner = classify({ interest_description: 'I run a small community organisation and want to learn AI', how_heard: '' });
  check('#16 "community organisation" (UK spelling) does NOT misroute a learner', orgSpellingLearner.label === 'learner', `got ${orgSpellingLearner.label}`);
  // ...but a genuine partner who mentions an org still routes on real intent verbs.
  const orgPartner = classify({ interest_description: 'Our organization would love to collaborate and sponsor community events', how_heard: '' });
  check('#16 real partner intent ("collaborate"/"sponsor") still routes partner when org present', orgPartner.label === 'partner', `got ${orgPartner.label}`);

  // #18 — `referral` is a discovery-context noun, not a partnership-intent
  // signal. For The Plug AI's faith-community / community-health-worker
  // audience, mentioning "a referral from my church" or "my caseworker gave me
  // a referral" is learner language. A single `referral` hit was enough to
  // clear the 0.7 threshold and misroute those learners to the founder inbox
  // (no welcome email). The phrase `'refer clients'` is retained as a genuine
  // partner-intent signal.
  const referralLearner = classify({ interest_description: 'I heard about The Plug AI through a referral from my church and I want to learn AI skills', how_heard: '' });
  check('#18 discovery-context "referral from my church" does NOT misroute a learner', referralLearner.label === 'learner', `got ${referralLearner.label}`);
  const caseWorkerReferral = classify({ interest_description: 'My caseworker gave me a referral to this program and I am hoping to learn', how_heard: '' });
  check('#18 "caseworker gave me a referral" does NOT misroute a learner', caseWorkerReferral.label === 'learner', `got ${caseWorkerReferral.label}`);
  // ...but the PHRASE "refer clients" still routes a genuine partner.
  const referClientsPartner = classify({ interest_description: 'We refer clients to community programs and would love to partner and collaborate', how_heard: '' });
  check('#18 real partner intent ("refer clients" + "collaborate") still routes partner', referClientsPartner.label === 'partner', `got ${referClientsPartner.label}`);

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
