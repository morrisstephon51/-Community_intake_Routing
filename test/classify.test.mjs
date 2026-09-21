// Consolidated classifier tests — covers the fixes folded into this branch:
//   #3 substring misroute → word-boundary matching
//   #5 learner default reported near-certain → neutral 0.5 confidence
//   #7 how_heard attribution pollutes intent scoring → intent field only
//   #9 single-keyword partner/volunteer downgraded to learner → evidence denominator
//   #12 web path drops `reasoning` → return-shape parity between the two copies
//   #22 service-seeking nouns misroute learners to volunteer inbox
//   #24 professional-context verb `serve` misroutes job-describing learners to volunteer inbox
//   #28 motivational phrase `give back` misroutes learners who describe their goal as giving back
//   #30 motivational phrase `support the community` misroutes learners who describe their professional role or learning goal
//   #32 motivational phrase `community service` misroutes learners describing church/community programs
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

  // #26 — motivational phrasal verb `help out` must not misroute learners
  // who frame their learning goal as helping their congregation or community.
  const helpOutCongregation = classify({ interest_description: 'I want to learn AI so I can help out my congregation', how_heard: '' });
  check('#26 "help out my congregation" does NOT misroute to volunteer', helpOutCongregation.label === 'learner', `got ${helpOutCongregation.label}`);
  const helpOutNeighbors = classify({ interest_description: 'AI tools can help out people in my neighborhood and I want to learn them', how_heard: '' });
  check('#26 "help out people in my neighborhood" does NOT misroute to volunteer', helpOutNeighbors.label === 'learner', `got ${helpOutNeighbors.label}`);
  const helpOutFamily = classify({ interest_description: "I'm hoping AI can help out my family and I want to be the one who brings those skills", how_heard: '' });
  check('#26 "help out my family" (learner motivation) does NOT misroute to volunteer', helpOutFamily.label === 'learner', `got ${helpOutFamily.label}`);
  // ...but a genuine volunteer with a clear `volunteer` keyword still routes correctly.
  const helpOutVolunteer = classify({ interest_description: "I want to volunteer and help out The Plug AI in any way I can", how_heard: '' });
  check('#26 genuine volunteer with "volunteer" keyword still routes volunteer', helpOutVolunteer.label === 'volunteer', `got ${helpOutVolunteer.label}`);

  // #28 — motivational phrasal verb `give back` must not misroute learners who
  // describe their learning goal as giving back to their community.
  const giveBackCommunity = classify({ interest_description: 'I want to learn AI so I can give back to my community', how_heard: '' });
  check('#28 "give back to my community" does NOT misroute to volunteer', giveBackCommunity.label === 'learner', `got ${giveBackCommunity.label}`);
  const giveBackChurch = classify({ interest_description: "I've always wanted to give back to my church and learning AI feels like the way", how_heard: '' });
  check('#28 "give back to my church" does NOT misroute to volunteer', giveBackChurch.label === 'learner', `got ${giveBackChurch.label}`);
  const giveBackFamily = classify({ interest_description: "Learning AI is my way of giving back to my family who sacrificed so much for me", how_heard: '' });
  check('#28 "giving back to my family" (learner motivation) does NOT misroute to volunteer', giveBackFamily.label === 'learner', `got ${giveBackFamily.label}`);
  // ...but a genuine volunteer with a clear `volunteer` keyword still routes correctly.
  const giveBackVolunteer = classify({ interest_description: "I want to volunteer at The Plug AI and give back to the mission", how_heard: '' });
  check('#28 genuine volunteer with "volunteer" keyword still routes volunteer', giveBackVolunteer.label === 'volunteer', `got ${giveBackVolunteer.label}`);

  // #30 — motivational phrase `support the community` must not misroute learners
  // who use it to describe their professional role or learning motivation.
  const supportSocialWorker = classify({ interest_description: 'I want to learn AI so I can better support the community I work with as a social worker', how_heard: '' });
  check('#30 "support the community" (social-work context) does NOT misroute to volunteer', supportSocialWorker.label === 'learner', `got ${supportSocialWorker.label}`);
  const supportEducator = classify({ interest_description: 'I teach at a public school and want to support the community through better technology', how_heard: '' });
  check('#30 "support the community" (educator context) does NOT misroute to volunteer', supportEducator.label === 'learner', `got ${supportEducator.label}`);
  const supportFaithLeader = classify({ interest_description: "As a pastor, supporting the community is my calling — I want AI skills to do it better", how_heard: '' });
  check('#30 "supporting the community" (faith-leader context) does NOT misroute to volunteer', supportFaithLeader.label === 'learner', `got ${supportFaithLeader.label}`);
  // ...but a genuine volunteer with a clear `volunteer` keyword still routes correctly.
  const supportVolunteer = classify({ interest_description: "I want to volunteer and support the community through The Plug AI", how_heard: '' });
  check('#30 genuine volunteer with "volunteer" keyword still routes volunteer', supportVolunteer.label === 'volunteer', `got ${supportVolunteer.label}`);

  // #32 — motivational phrase `community service` must not misroute learners
  // who describe their existing church/community programs.
  const csChurch = classify({ interest_description: 'Our church community service program helps seniors and I want AI tools for it', how_heard: '' });
  check('#32 "community service" (church program context) does NOT misroute to volunteer', csChurch.label === 'learner', `got ${csChurch.label}`);
  const csPersonal = classify({ interest_description: 'I do community service at the food bank every weekend and want AI skills for my day job', how_heard: '' });
  check('#32 "community service" (personal activity context) does NOT misroute to volunteer', csPersonal.label === 'learner', `got ${csPersonal.label}`);
  const csYouth = classify({ interest_description: 'I coordinate community service for our youth group and AI tools would really help', how_heard: '' });
  check('#32 "community service" (youth coordinator context) does NOT misroute to volunteer', csYouth.label === 'learner', `got ${csYouth.label}`);
  // ...but a genuine volunteer with the `volunteer` keyword still routes correctly.
  const csVolunteer = classify({ interest_description: 'I want to volunteer — I can offer community service hours to The Plug AI team', how_heard: '' });
  check('#32 genuine volunteer with "volunteer" keyword still routes volunteer', csVolunteer.label === 'volunteer', `got ${csVolunteer.label}`);

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

  // #36 — `donate time` and `contribute time` describe existing charitable
  // activity elsewhere, not an offer to volunteer at The Plug AI. A learner
  // who says "I donate time at our food pantry and want AI tools" is a learner
  // seeking skills for their existing service work, not offering to volunteer
  // at The Plug AI. Same class as #26/#28/#30/#32.
  const donateTimeFoodPantry = classify({ interest_description: 'I donate time at our food pantry every week and want to learn how AI tools could help our ministry be more efficient', how_heard: '' });
  check('#36 "donate time at our food pantry" does NOT misroute to volunteer', donateTimeFoodPantry.label === 'learner', `got ${donateTimeFoodPantry.label}`);
  const donateTimeChurch = classify({ interest_description: "I've always donated time to our church outreach and want to learn AI so I can do more", how_heard: '' });
  check('#36 "donated time to church outreach" (learner motivation) does NOT misroute to volunteer', donateTimeChurch.label === 'learner', `got ${donateTimeChurch.label}`);
  const contributeTimeCommunity = classify({ interest_description: 'I contribute time to my community organization and want to learn AI to do more good', how_heard: '' });
  check('#36 "contribute time to my community org" does NOT misroute to volunteer', contributeTimeCommunity.label !== 'volunteer', `got ${contributeTimeCommunity.label}`);
  const contributeTimeCSR = classify({ interest_description: 'Our company is willing to contribute time to this initiative as part of our CSR program', how_heard: '' });
  check('#36 "contribute time" (CSR context) does NOT misroute to volunteer', contributeTimeCSR.label !== 'volunteer', `got ${contributeTimeCSR.label}`);
  // Genuine volunteers still route correctly via `volunteer`/`volunteering`.
  const stillVolunteer = classify({ interest_description: 'I want to volunteer and donate my time to help The Plug AI grow', how_heard: '' });
  check('#36 genuine volunteer with "volunteer" keyword still routes volunteer', stillVolunteer.label === 'volunteer', `got ${stillVolunteer.label}`);
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
  'I want to learn AI so I can give back to my community',
  'Our church community service program helps seniors and I want AI tools for it',
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
