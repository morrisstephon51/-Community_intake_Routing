// Shared routing-action / email construction for BOTH entry points — the CLI
// (intake.js main) and the serverless web handler (api/intake.js). Single source
// of truth so the two paths can never drift on WHO a submission is routed to or
// what the welcome / founder-alert copy says. Extracted for #39: the web path
// had no routing step at all, and a second inline copy here would have re-created
// the exact classify()-style twin-drift the parity tests exist to prevent.

const FOUNDER_EMAIL      = process.env.FOUNDER_EMAIL      || 'morrisstephon51@gmail.com';
const VOLUNTEER_FORM_URL = process.env.VOLUNTEER_FORM_URL || 'https://theplugai.com/volunteer';

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

export { buildEmail };
