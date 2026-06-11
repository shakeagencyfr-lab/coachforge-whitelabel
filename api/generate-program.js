const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return { json: JSON.parse(clean), tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, workspace_id, type = 'combined', language = 'fr' } = req.body;
    if (!client_id || !workspace_id) return res.status(400).json({ error: 'client_id and workspace_id required' });

    const clients = await supabaseRequest(`/clients?id=eq.${client_id}&workspace_id=eq.${workspace_id}`);
    const client = clients[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const workspaces = await supabaseRequest(`/workspaces?id=eq.${workspace_id}`);
    const workspace = workspaces[0];
    if (workspace.generations_used >= workspace.generation_quota) {
      return res.status(402).json({ error: 'quota_exceeded' });
    }

    const programs = await supabaseRequest('/programs', 'POST', {
      workspace_id, client_id, type, language, status: 'generating'
    });
    const program = programs[0];

    let content_json = {};
    let totalTokens = 0;

    if (type === 'training' || type === 'combined') {
      const prompt = `Tu es coach sportif expert. Génère un programme d'entraînement 12 semaines en JSON strict pour :
- Nom: ${client.full_name}, Niveau: ${client.fitness_level}, Objectif: ${client.goal}
- ${client.available_days} jours/semaine, ${client.session_duration_min} min/séance
- Équipement: ${client.equipment}, Blessures: ${client.injuries || 'Aucune'}
Réponds UNIQUEMENT en JSON: {"program_title":"","duration_weeks":12,"phases":[{"phase":1,"name":"","weeks":"1-4","goal":"","sessions":[{"day":"","focus":"","exercises":[{"name":"","sets":0,"reps":"","rpe":0,"rest_seconds":0}]}]}],"general_tips":[]}`;
      const { json, tokens } = await callClaude(prompt);
      content_json.training = json;
      totalTokens += tokens;
    }

    if (type === 'nutrition' || type === 'combined') {
      const prompt = `Tu es nutritionniste expert. Génère un plan nutritionnel en JSON strict pour :
- Nom: ${client.full_name}, Objectif: ${client.goal}, Poids: ${client.weight_kg}kg
- Calories: ${client.daily_calories || 'à calculer'}, Préférences: ${client.dietary_preferences || 'Aucune'}
Réponds UNIQUEMENT en JSON: {"plan_title":"","daily_calories":0,"macros":{"protein_g":0,"carbs_g":0,"fat_g":0},"meals":[{"name":"","time":"","calories":0,"foods":[{"item":"","quantity":"","calories":0}]}],"tips":[]}`;
      const { json, tokens } = await callClaude(prompt);
      content_json.nutrition = json;
      totalTokens += tokens;
    }

    await supabaseRequest(`/programs?id=eq.${program.id}`, 'PATCH', { content_json, status: 'ready' });
    await supabaseRequest(`/workspaces?id=eq.${workspace_id}`, 'PATCH', { generations_used: workspace.generations_used + 1 });
    await supabaseRequest('/generation_logs', 'POST', {
      workspace_id, program_id: program.id, tokens_used: totalTokens,
      model: 'claude-haiku-4-5-20251001', status: 'success'
    });

    return res.status(200).json({ program_id: program.id, content_json });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
