module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const checks = {
    env_supabase_url: !!process.env.SUPABASE_URL,
    env_supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
    env_anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    env_markupgo_key: !!process.env.MARKUPGO_API_KEY,
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reponds juste OK' }],
      }),
    });
    const data = await r.json();
    checks.anthropic_test = data.content?.[0]?.text || data.error?.message || 'unknown';
  } catch (e) {
    checks.anthropic_test = 'ERROR: ' + e.message;
  }

  return res.status(200).json(checks);
};
