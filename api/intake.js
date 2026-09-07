import { createClient } from '@supabase/supabase-js';

const SIGNALS = {
  partner: {
    // Partnership-INTENT signals only, NOT first-person affiliation nouns.
    // `business`/`company`/`enterprise`/`agency` merely describe the inquirer's
    // context ("learn AI for my small business") and under #9's evidence
    // denominator a single one cleared 0.7 and misrouted clear learners to the
    // founder inbox with no welcome email. Genuine partners still match
    // sponsor/collaborate/partner/refer/invest. Kept in lockstep with intake.js.
    keywords: [
      'collaborate', 'collaboration', 'sponsor', 'sponsorship',
      'organization', 'organisation', 'refer clients', 'referral', 'partner',
      'partnership', 'brand', 'b2b', 'corporate', 'investor', 'invest',
      'fund', 'funding',
    ],
  },
  volunteer: {
    keywords: [
      'volunteer', 'volunteering', 'give back', 'contribute time', 'mentor',
      'mentoring', 'mentorship', 'help out', 'community service', 'donate time',
      'serve', 'support the community', 'teach', 'coach',
    ],
  },
};

function matchesKeyword(text, kw) {
  // Whole-word/phrase match, NOT a bare substring, so short keywords (fund,
  // invest, serve, teach) don't collide with longer words (fundamentals,
  // investigate, deserve, teacher) and misroute intake. See #3.
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function classify(payload) {
  // Classify on the intent field only; how_heard is attribution metadata, not intent. See #7.
  const text = (payload.interest_description || '').toLowerCase();
  const scores = { learner: 0.5, partner: 0, volunteer: 0 };

  for (const [label, { keywords }] of Object.entries(SIGNALS)) {
    for (const kw of keywords) {
      if (matchesKeyword(text, kw)) scores[label] += 1;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = sorted[0];
  // #5 neutral learner default + #9 evidence-only denominator for real winners.
  const evidence = scores.partner + scores.volunteer;
  const confidence = topLabel === 'learner'
    ? 0.5
    : Math.min(topScore / evidence, 0.99);

  if (confidence < 0.7 && topLabel !== 'learner') {
    return { label: 'learner', confidence: 0.65 };
  }

  return { label: topLabel, confidence: parseFloat(confidence.toFixed(3)) };
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

  const record = {
    ...payload,
    classification: classification.label,
    confidence: classification.confidence,
    status: 'routed',
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('community_intake').insert(record);
    } catch (err) {
      console.error('Supabase insert failed:', err.message);
    }
  } else {
    // Supabase not configured yet — log to Vercel function logs so
    // submissions are recoverable instead of silently discarded.
    console.log('community_intake submission (no Supabase configured):', JSON.stringify(record));
  }

  return res.status(200).json({ success: true, classification: classification.label });
}
