module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const checks = {
    method: req.method,
    body_received: req.body || 'EMPTY',
    body_type: typeof req.body,
  };

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/workspaces?select=id,name&limit=1`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    checks.supabase_status = r.status;
    checks.supabase_data = await r.json();
  } catch (e) {
    checks.supabase_error = e.message;
  }

  return res.status(200).json(checks);
};
