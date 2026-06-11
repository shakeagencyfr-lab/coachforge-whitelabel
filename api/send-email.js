const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function supabaseRequest(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { program_id } = req.body;
    if (!program_id) return res.status(400).json({ error: 'program_id required' });

    const programs = await supabaseRequest(`/programs?id=eq.${program_id}`);
    const program = programs[0];
    if (!program) return res.status(404).json({ error: 'Program not found' });
    if (!program.pdf_url) return res.status(400).json({ error: 'PDF not generated yet' });

    const clients = await supabaseRequest(`/clients?id=eq.${program.client_id}`);
    const workspaces = await supabaseRequest(`/workspaces?id=eq.${program.workspace_id}`);
    const client = clients[0];
    const workspace = workspaces[0];

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: workspace.name, email: 'noreply@coachforge.io' },
        to: [{ email: client.email, name: client.full_name }],
        subject: `🏋️ Votre programme personnalisé est prêt !`,
        htmlContent: `
          <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
            <h1 style="color:${workspace.primary_color || '#7c3aed'}">${workspace.name}</h1>
            <h2>Bonjour ${client.full_name} 👋</h2>
            <p>Votre programme personnalisé est disponible !</p>
            <a href="${program.pdf_url}" style="background:${workspace.primary_color || '#7c3aed'};color:white;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:24px 0">
              📄 Télécharger mon programme
            </a>
            <p style="color:#999;font-size:12px">Programme confidentiel — ${workspace.name}</p>
          </body>
        `,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json();
      throw new Error(err.message || 'Brevo error');
    }

    await supabaseRequest(`/programs?id=eq.${program_id}`, 'PATCH', {
      email_sent: true, email_sent_at: new Date().toISOString()
    });

    return res.status(200).json({ success: true, email: client.email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
