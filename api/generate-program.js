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

async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: '{' }
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = '{' + (data.content?.[0]?.text || '');
  const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  return { json: JSON.parse(text), tokens };
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
    if (workspace.generations_used >= workspace.generation_quota) return res.status(402).json({ error: 'quota_exceeded' });

    const programs = await supabaseRequest('/programs', 'POST', {
      workspace_id, client_id, type, language, status: 'generating'
    });
    const program = programs[0];

    let content_json = {};
    let totalTokens = 0;

    if (type === 'training' || type === 'combined') {
      const system = `Tu es coach sportif. Tu reponds UNIQUEMENT en JSON valide, sans texte, sans markdown, sans commentaires. Chaque string JSON ne doit pas contenir de guillemets, apostrophes ou caracteres speciaux.`;
      const user = `Programme 4 semaines pour: ${client.full_name}, niveau ${client.fitness_level || 'debutant'}, objectif ${client.goal || 'forme'}, ${client.available_days || 3} jours semaine, ${client.equipment || 'salle'}.
Reponds avec exactement ce format JSON (remplace les valeurs entre <>):
"program_title": "<titre>",
"duration_weeks": 4,
"sessions": [
{"week": 1, "day": "Lundi", "focus": "<focus>", "exercises": [{"name": "<exercice1>", "sets": 3, "reps": "10-12", "rest_seconds": 90}, {"name": "<exercice2>", "sets": 3, "reps": "10-12", "rest_seconds": 90}, {"name": "<exercice3>", "sets": 3, "reps": "10-12", "rest_seconds": 90}]},
{"week": 1, "day": "Mercredi", "focus": "<focus>", "exercises": [{"name": "<exercice1>", "sets": 3, "reps": "10-12", "rest_seconds": 90}, {"name": "<exercice2>", "sets": 3, "reps": "10-12", "rest_seconds": 90}]},
{"week": 1, "day": "Vendredi", "focus": "<focus>", "exercises": [{"name": "<exercice1>", "sets": 3, "reps": "10-12", "rest_seconds": 90}, {"name": "<exercice2>", "sets": 3, "reps": "10-12", "rest_seconds": 90}]}
],
"tips": ["<conseil1>", "<conseil2>"]
}`;
      const { json, tokens } = await callClaude(system, user);
      content_json.training = json;
      totalTokens += tokens;
    }

    if (type === 'nutrition' || type === 'combined') {
      const system = `Tu es nutritionniste. Tu reponds UNIQUEMENT en JSON valide, sans texte, sans markdown, sans commentaires. Chaque string JSON ne doit pas contenir de guillemets, apostrophes ou caracteres speciaux.`;
      const user = `Plan nutrition pour: ${client.full_name}, objectif ${client.goal || 'forme'}, ${client.weight_kg || 75}kg, ${client.dietary_preferences || 'omnivore'}.
Reponds avec exactement ce format JSON (remplace les valeurs entre <>):
"plan_title": "<titre>",
"daily_calories": <nombre>,
"macros": {"protein_g": <nombre>, "carbs_g": <nombre>, "fat_g": <nombre>},
"meals": [
{"name": "Petit-dejeuner", "time": "7h00", "calories": <nombre>, "foods": [{"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}, {"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}]},
{"name": "Dejeuner", "time": "12h30", "calories": <nombre>, "foods": [{"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}, {"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}]},
{"name": "Diner", "time": "19h30", "calories": <nombre>, "foods": [{"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}, {"item": "<aliment>", "quantity": "<quantite>", "calories": <nombre>}]}
],
"tips": ["<conseil1>", "<conseil2>"]
}`;
      const { json, tokens } = await callClaude(system, user);
      content_json.nutrition = json;
      totalTokens += tokens;
    }

    await supabaseRequest(`/programs?id=eq.${program.id}`, 'PATCH', { content_json, status: 'ready' });
    await supabaseRequest(`/workspaces?id=eq.${workspace_id}`, 'PATCH', { generations_used: workspace.generations_used + 1 });
    await supabaseRequest('/generation_logs', 'POST', {
      workspace_id, program_id: program.id, tokens_used: totalTokens, model: 'claude-sonnet-4-6', status: 'success'
    });

    return res.status(200).json({ program_id: program.id, content_json });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
