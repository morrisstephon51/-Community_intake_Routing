#!/usr/bin/env node
/**
 * The Plug AI — Community Intake Routing Agent
 *
 * Usage:
 *   echo '{"name":"...","email":"..."}' | node intake.js
 *   node intake.js --fixture learner|partner|volunteer
 *   node intake.js path/to/payload.json
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL        = process.env.SUPABASE_URL        || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const FOUNDER_EMAIL       = process.env.FOUNDER_EMAIL        || 'morrisstephon51@gmail.com';
const VOLUNTEER_FORM_URL  = process.env.VOLUNTEER_FORM_URL   || 'https://theplugai.com/volunteer';
const SENDER_EMAIL        = process.env.SENDER_EMAIL         || 'morrisstephon51@gmail.com';
const TEST_MODE           = process.env.TEST_MODE !== 'false';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURES = {
  learner: {
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    zip: '30301',
    interest_description: 'I want to learn how to use AI for my small business and grow my skills.',
    how_heard: 'Instagram',
  },
  partner: {
    name: 'Priya Sharma',
    email: 'priya@techcorp.com',
    zip: '94105',
    interest_description: 'Our organization would love to collaborate and sponsor community events. We refer clients regularly.',
    how_heard: 'LinkedIn',
  },
  volunteer: {
    name: 'Marcus Webb',
    email: 'marcus@example.com',
    zip: '10001',
    interest_description: 'I want to volunteer and give back by mentoring young entrepreneurs in my community.',
    how_heard: 'Word of mouth',
  },
};

// ── Intent-based classifier (root-cause consolidation) ─────────────────────────
// Supersedes the one-keyword-removal chain #14 #16 #18 #20 #22 #24 #26 #28 #30
// #32 #34 #36. Root cause of that non-terminating PR tower: the prior design
// scored a FLAT BAG of keywords, so any topic/affiliation/motivation/profession
// word that merely describes the inquirer's OWN context (brand, corporate,
// organization, referral, invest, fund/funding, collaborate, give back, help
// out, serve, support the community, community service, donate/contribute time,
// or a mentor/coach/tutor being *sought*) cleared the 0.7 threshold and misrouted
// a clear learner — who then never received the welcome email (the learner path
// is the only one that emits it). Keyword PRESENCE != intent. This classifier
// routes partner/volunteer ONLY on a high-precision signal of intent to act
// *toward The Plug AI*, and defaults everything else to learner.
//
// Kept byte-identical between intake.js and api/intake.js — both write the same
// community_intake row, so classify() must not drift (parity-tested).

// Strong signals: essentially only a genuine partner/volunteer writes these
// about The Plug AI. A single hit routes.
const PARTNER_SIGNALS = [
  /\bsponsor(ship|ships|ing)?\b/,
  /\bpartnership\b/,
  /\bpartner(ing)?\s+with\b/,
  /\brefer\s+clients\b/,
  /\bb2b\b/,
];

const VOLUNTEER_SIGNALS = [
  /\bvolunteer(ing|s)?\b/,
];

// teach / mentor / coach / tutor count as a volunteer signal ONLY when the
// inquirer OFFERS to do them for others — never when they are the thing being
// *sought*. "I want to teach and mentor students" → volunteer; "teach me",
// "I need a mentor", "looking for coaching" → learner. This is what lets the
// consolidation keep BOTH the genuine-offer case (#3) AND the seeking-learner
// case (#22), which a flat delete of teach/mentor/coach could not.
const VOLUNTEER_OFFER_VERB = /\b(teach|mentor|mentoring|tutor|coach)\b/;
// A genuine OFFER to teach = an intent verb GOVERNING the teach verb ("want to
// teach", "hoping to mentor", "willing to help coach"), OR the teach verb taking
// a beneficiary object ("teach students", "mentor youth"). Tighter than the old
// "any intent word anywhere in the text" gate: an educator who writes "I teach at
// a public school and want to <learn/support>" is stating a profession — the
// `want` governs a different verb — so it must fall back to learner (#30), while a
// genuine "I want to teach and mentor students" (#3) still routes volunteer.
const OFFER_TO_TEACH = /\b(want|wanting|wish|hope|hoping|like|love|willing|eager|ready|able|plan|planning|offer|offering|can|will|could|would)\s+(to\s+)?(help\s+)?(teach|mentor|tutor|coach)\b/;
const TEACH_BENEFICIARY = /\b(teach|mentor|mentoring|tutor|tutoring|coach|coaching)\s+(and\s+\w+\s+)?(the\s+|our\s+|young\s+|local\s+|other\s+|my\s+)?(students?|kids?|children|youth|people|others|entrepreneurs?|members?|communities|folks|adults?|families|seniors?|women|men|girls?|boys?|learners?)\b/;
const SEEKING = /\bteach\s+(me|us)\b|\b(need|needs|needing|want|wants|wanting|looking|look|seeking|seek|find|finding|get|getting|hire|hiring)\s+(a\s+|an\s+|some\s+|the\s+|for\s+a\s+|for\s+an\s+)?(mentor|mentors|coach|coaches|coaching|tutor|tutors|tutoring|mentoring|mentorship)\b|\b(a|an|my|the)\s+(mentor|coach|tutor)\b/;

function matchSignals(text, patterns) {
  const hits = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) hits.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return hits;
}

function partnerHits(text) {
  return matchSignals(text, PARTNER_SIGNALS);
}

function volunteerHits(text) {
  const hits = matchSignals(text, VOLUNTEER_SIGNALS);
  const verb = text.match(VOLUNTEER_OFFER_VERB);
  if (verb && !SEEKING.test(text) && (OFFER_TO_TEACH.test(text) || TEACH_BENEFICIARY.test(text))) hits.push(verb[0]);
  return hits;
}

function classify(payload) {
  // Classify on the intent field only. `how_heard` is marketing-attribution
  // metadata (e.g. "Instagram", "a brand partner referred me") — scoring it leaks
  // the *source* into the *intent* and misroutes learners. See #7.
  const text = (payload.interest_description || '').toLowerCase();

  const pHits = partnerHits(text);
  const vHits = volunteerHits(text);

  // Learner is the default; its 0.5 baseline wins ties (no partner/volunteer
  // evidence). Each matched signal is worth 1.
  const scores = { learner: 0.5, partner: pHits.length, volunteer: vHits.length };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = sorted[0];

  // #5 — a signal-less learner default carries no evidence; report a neutral 0.5
  //      rather than a ratio that collapses to ~1.0 and looks near-certain.
  // #9 — a genuine partner/volunteer winner is scored against matched-signal
  //      evidence only, so a real single-signal inquiry clears the 0.7 threshold.
  const evidence = scores.partner + scores.volunteer;
  const confidence = topLabel === 'learner'
    ? 0.5
    : Math.min(topScore / evidence, 0.99);

  const matched = topLabel === 'partner' ? pHits : topLabel === 'volunteer' ? vHits : [];
  const reasoning = topLabel === 'learner'
    ? `No strong partner or volunteer signals found. Defaulting to learner (confidence: ${confidence.toFixed(2)}).`
    : `Matched ${topLabel} signals: [${matched.join(', ')}]. Confidence: ${confidence.toFixed(2)}.`;

  // Hard fallback: if confidence below threshold, always learner.
  if (confidence < 0.7 && topLabel !== 'learner') {
    return {
      label: 'learner',
      confidence: 0.65,
      reasoning: `Confidence ${confidence.toFixed(2)} below 0.7 threshold. Defaulting to learner. Original signals: ${reasoning}`,
    };
  }

  return { label: topLabel, confidence: parseFloat(confidence.toFixed(3)), reasoning };
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildEmail(label, payload) {
  const { name, email } = payload;

  if (label === 'learner') {
    return {
      to: email,
      subject: `Welcome to The Plug AI, ${name}!`,
      body: `Hi ${name},\n\nThank you for your interest in The Plug AI! We've added you to our waitlist and will be in touch soon with access to our learning resources.\n\nStay tuned — big things are coming.\n\nWith love,\nThe Plug AI Team`,
    };
  }

  if (label === 'partner') {
    return {
      to: FOUNDER_EMAIL,
      subject: `New Partner Inquiry — ${name}`,
      body: `Founder alert: A potential partner just submitted an intake form.\n\nName: ${name}\nEmail: ${email}\nZip: ${payload.zip || 'N/A'}\nHow they heard: ${payload.how_heard || 'N/A'}\n\nWhat they said:\n"${payload.interest_description}"\n\nReach out within 48 hours.`,
    };
  }

  // volunteer
  return {
    to: email,
    subject: `Thank you for wanting to give back, ${name}!`,
    body: `Hi ${name},\n\nWe love your energy! The Plug AI is always looking for passionate people like you.\n\nPlease complete our volunteer intake form to get started:\n${VOLUNTEER_FORM_URL}\n\nWe'll be in touch soon.\n\nWith gratitude,\nThe Plug AI Team`,
  };
}

// ── Email send (Gmail MCP — runs in Claude Code context) ──────────────────────
// In standalone node context this logs; inside Claude Code the MCP call is made
// by the parent agent after reading the printed action payload.

async function sendEmail(emailPayload) {
  if (TEST_MODE) {
    console.log('\n📧  TEST MODE — email not sent. Payload:');
    console.log(JSON.stringify(emailPayload, null, 2));

    const confirmed = await promptConfirm('  Send this email for real? (y/N): ');
    if (!confirmed) {
      console.log('  Skipped — staying in test mode.');
      return { sent: false, mode: 'test' };
    }
  }

  // Emit a structured action for the Claude Code agent to execute via Gmail MCP
  console.log('\n__GMAIL_ACTION__');
  console.log(JSON.stringify({ action: 'send_email', ...emailPayload }));
  return { sent: true, mode: TEST_MODE ? 'confirmed-test' : 'live' };
}

function promptConfirm(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ── Supabase logger ───────────────────────────────────────────────────────────

async function logToSupabase(payload, classification) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('  ⚠  SUPABASE_URL or SUPABASE_SERVICE_KEY not set — skipping DB log.');
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const record = {
    name:                 payload.name,
    email:                payload.email,
    zip:                  payload.zip || null,
    interest_description: payload.interest_description || null,
    how_heard:            payload.how_heard || null,
    classification:       classification.label,
    confidence:           classification.confidence,
    reasoning:            classification.reasoning,
    status:               'routed',
  };

  const { data, error } = await supabase
    .from('community_intake')
    .insert(record)
    .select('id')
    .single();

  if (error) {
    console.error('  ✗ Supabase insert failed:', error.message);
    return null;
  }

  console.log(`  ✓ Logged to Supabase — id: ${data.id}`);
  return data.id;
}

// ── Payload parser ────────────────────────────────────────────────────────────

function parsePayload(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    console.warn('  ⚠  Malformed JSON — using empty payload, defaulting to learner.');
    parsed = {};
  }

  return {
    name:                 String(parsed.name  || 'Anonymous').slice(0, 200),
    email:                String(parsed.email || 'unknown@example.com').slice(0, 200),
    zip:                  parsed.zip                  ? String(parsed.zip).slice(0, 10)  : null,
    interest_description: parsed.interest_description ? String(parsed.interest_description).slice(0, 2000) : null,
    how_heard:            parsed.how_heard             ? String(parsed.how_heard).slice(0, 200) : null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();

  // Resolve input source
  let rawPayload;
  const arg = process.argv[2];

  if (arg === '--fixture') {
    const fixtureKey = process.argv[3];
    if (!FIXTURES[fixtureKey]) {
      console.error(`Unknown fixture "${fixtureKey}". Choose: learner, partner, volunteer`);
      process.exit(1);
    }
    rawPayload = FIXTURES[fixtureKey];
    console.log(`\n[The Plug AI Intake Agent] Running fixture: ${fixtureKey}\n`);
  } else if (arg && !arg.startsWith('--')) {
    rawPayload = readFileSync(arg, 'utf8');
    console.log(`\n[The Plug AI Intake Agent] Reading from file: ${arg}\n`);
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawPayload = chunks.join('');
    console.log('\n[The Plug AI Intake Agent] Reading from stdin\n');
  }

  // 1. Parse
  const payload = parsePayload(rawPayload);
  console.log(`  Input  → ${payload.name} <${payload.email}>`);

  // 2. Classify
  const classification = classify(payload);
  console.log(`  Class  → ${classification.label.toUpperCase()} (confidence: ${classification.confidence})`);
  console.log(`  Reason → ${classification.reasoning}`);

  // 3. Build routing action
  const emailPayload = buildEmail(classification.label, payload);
  console.log(`  Route  → ${classification.label === 'partner' ? 'notify founder' : `email ${emailPayload.to}`}`);

  // 4. Send email
  const emailResult = await sendEmail(emailPayload);

  // 5. Log to Supabase
  const recordId = await logToSupabase(payload, classification);

  // 6. Summary
  const elapsed = Date.now() - start;
  console.log(`\n  ✓ Done in ${elapsed}ms`);

  return {
    classification,
    emailResult,
    supabaseId: recordId,
    elapsedMs: elapsed,
  };
}

export { classify };

const isMainModule = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch(err => {
    console.error('\n✗ Fatal error:', err.message);
    process.exit(1);
  });
}
