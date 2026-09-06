import { createClient } from '@supabase/supabase-js';

const SIGNALS = {
  partner: {
    keywords: [
      'business', 'collaborate', 'collaboration', 'sponsor', 'sponsorship',
      'organization', 'organisation', 'refer clients', 'referral', 'partner',
      'partnership', 'brand', 'b2b', 'corporate', 'investor', 'invest',
      'fund', 'funding', 'enterprise', 'company', 'agency',
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

function classify(payload) {
  const text = [payload.interest_description || '', payload.how_heard || ''].join(' ').toLowerCase();
  const scores = { learner: 0.5, partner: 0, volunteer: 0 };

  for (const [label, { keywords }] of Object.entries(SIGNALS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) scores[label] += 1;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = sorted[0];
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  // The learner 0.5 baseline is a tie-breaking prior, not evidence. Leaving it in
  // the confidence denominator forces any single-keyword partner/volunteer
  // (topScore 1.0 -> 1.0/1.5 = 0.667) below the 0.7 routing threshold, silently
  // downgrading genuine one-line sponsor/partner/mentor inquiries to the learner
  // waitlist. Score a real winner against matched signal evidence only.
  const evidence = scores.partner + scores.volunteer;
  const confidence = topLabel === "learner"
    ? Math.min(topScore / total, 0.99)
    : Math.min(topScore / evidence, 0.99);

  if (confidence < 0.7 && topLabel !== 'learner') {
    return { label: 'learner', confidence: 0.65 };
  }

  return { label: topLabel, confidence: parseFloat(confidence.toFixed(3)) };
}

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
