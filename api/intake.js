import { createClient } from '@supabase/supabase-js';

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
const OFFER_INTENT = /\b(want|wanting|wish|hope|hoping|like|love|willing|eager|ready|able|plan|planning|offer|offering|can|will)\b/;
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
  if (verb && OFFER_INTENT.test(text) && !SEEKING.test(text)) hits.push(verb[0]);
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

export { classify };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const payload = {
    name: String(body.name || 'Anonymous').slice(0, 200),
    email: String(body.email || '').slice(0, 200),
    zip: body.zip ? String(body.zip).slice(0, 10) : null,
    interest_description: body.interest_description ? String(body.interest_description).slice(0, 2000) : null,
    how_heard: body.how_heard ? String(body.how_heard).slice(0, 200) : null,
  };

  if (!payload.email || !payload.email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const classification = classify(payload);

  // #12 — write the SAME column set as the CLI path (intake.js logToSupabase),
  // including `reasoning`. Previously the web path omitted it, so the founder
  // lost the classification rationale for exactly the real inquiries.
  const record = {
    ...payload,
    classification: classification.label,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    status: 'routed',
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      // supabase-js returns a Postgres error as { error } instead of throwing,
      // so the old try/catch alone never saw constraint violations — a failed
      // insert was silently dropped with no trace. Capture and check `error`
      // (like intake.js does) and log the full record either way so a real
      // submission is always recoverable. See #12.
      const { error } = await supabase.from('community_intake').insert(record);
      if (error) {
        console.error('Supabase insert failed:', error.message);
        console.log('community_intake submission (insert failed, recoverable):', JSON.stringify(record));
      }
    } catch (err) {
      console.error('Supabase insert threw:', err.message);
      console.log('community_intake submission (insert threw, recoverable):', JSON.stringify(record));
    }
  } else {
    // Supabase not configured yet — log to Vercel function logs so
    // submissions are recoverable instead of silently discarded.
    console.log('community_intake submission (no Supabase configured):', JSON.stringify(record));
  }

  return res.status(200).json({ success: true, classification: classification.label });
}
