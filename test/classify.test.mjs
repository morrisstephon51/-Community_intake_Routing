// Consolidated classifier tests — covers the four fixes folded into this branch:
//   #3 substring misroute → word-boundary matching
//   #5 learner default reported near-certain → neutral 0.5 confidence
//   #7 how_heard attribution pollutes intent scoring → intent field only
//   #9 single-keyword partner/volunteer downgraded to learner → evidence denominator
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
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
