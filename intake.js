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

// ── Classifier ────────────────────────────────────────────────────────────────
// Weighted keyword scorer — no API cost. Returns same interface as a Claude API call.

const SIGNALS = {
  partner: {
    keywords: [
      'business', 'collaborate', 'collaboration', 'sponsor', 'sponsorship',
      'organization', 'organisation', 'refer clients', 'referral', 'partner',
      'partnership', 'brand', 'b2b', 'corporate', 'investor', 'invest',
      'fund', 'funding', 'enterprise', 'company', 'agency',
    ],
    weight: 1.0,
  },
  volunteer: {
    keywords: [
      'volunteer', 'volunteering', 'give back', 'contribute time', 'mentor',
      'mentoring', 'mentorship', 'help out', 'community service', 'donate time',
      'serve', 'support the community', 'teach', 'coach',
    ],
    weight: 1.0,
  },
};

function classify(payload) {
  const text = [
    payload.interest_description || '',
    payload.how_heard || '',
  ].join(' ').toLowerCase();

  const scores = { learner: 0, partner: 0, volunteer: 0 };

  for (const [label, { keywords, weight }] of Object.entries(SIGNALS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        scores[label] += weight;
      }
    }
  }

  // Learner is the default; give it a baseline so it wins ties
  scores.learner += 0.5;

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  const [topLabel, topScore] = sorted[0];
  // A signal-less learner default carries no evidence: its 0.5 baseline is the
  // only contribution to `total`, so topScore/total collapses to ~1.0 and would
  // misreport a pure fallback as near-certain (0.99). Learner can only be top
  // when no partner/volunteer keyword matched, so report a neutral 0.5 there and
  // reserve the ratio for wins actually driven by matched keywords.
  const confidence = topLabel === 'learner'
    ? 0.5
    : (total > 0 ? Math.min(topScore / total, 0.99) : 0.5);

  const matchedKeywords = topLabel !== 'learner'
    ? SIGNALS[topLabel].keywords.filter(kw => text.includes(kw))
    : [];

  const reasoning = topLabel === 'learner'
    ? `No strong partner or volunteer signals found. Defaulting to learner (confidence: ${confidence.toFixed(2)}).`
    : `Matched ${topLabel} keywords: [${matchedKeywords.join(', ')}]. Confidence: ${confidence.toFixed(2)}.`;

  // Hard fallback: if confidence below threshold, always learner
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

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message);
  process.exit(1);
});
