const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
  });
}

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
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
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
      model: 'claude-haiku-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Anthropic: ' + data.error.message);
  const text = (data.content?.[0]?.text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON: ' + text.slice(0, 200));
  return { json: JSON.parse(text.slice(start, end + 1)), tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { client_id, workspace_id, type = 'training', language = 'fr' } = body;
    if (!client_id || !workspace_id) return res.status(400).json({ error: 'client_id and workspace_id required', received: body });

    const clients = await supabaseRequest(`/clients?id=eq.${client_id}&workspace_id=eq.${workspace_id}`);
    const client = clients[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const workspaces = await supabaseRequest(`/workspaces?id=eq.${workspace_id}`);
    const workspace = workspaces[0];
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.generations_used >= workspace.generation_quota) return res.status(402).json({ error: 'quota_exceeded' });

    const programs = await supabaseRequest('/programs', 'POST', {
      workspace_id, client_id, type, language, status: 'generating'
    });
    const program = programs[0];

    let content_json = {};
    let totalTokens = 0;

    if (type === 'nutrition') {
      const r = await callClaude(
        `Reponds avec UNIQUEMENT du JSON valide. Pas de markdown.
Profil: objectif ${client.goal || 'forme'}, poids ${client.weight_kg || 75}kg.
Retourne ce JSON adapte:
{"plan_title":"Plan nutrition","daily_calories":2000,"macros":{"protein_g":150,"carbs_g":220,"fat_g":65},"meals":[{"name":"Petit dejeuner","time":"7h00","calories":450,"foods":[{"item":"Flocons avoine","quantity":"80g","calories":300}]},{"name":"Dejeuner","time":"12h30","calories":650,"foods":[{"item":"Poulet","quantity":"150g","calories":250}]},{"name":"Diner","time":"19h30","calories":550,"foods":[{"item":"Saumon","quantity":"130g","calories":270}]}],"tips":["Boire 2L par jour"]}`
      );
      content_json.nutrition = r.json;
      totalTokens += r.tokens;
    } else {
      const r = await callClaude(
        `Reponds avec UNIQUEMENT du JSON valide. Pas de markdown.
Profil: niveau ${client.fitness_level || 'debutant'}, objectif ${client.goal || 'forme'}, ${client.available_days || 3}j/semaine.
Retourne ce JSON adapte:
{"program_title":"Programme 4 semaines","duration_weeks":4,"sessions":[{"day":"Lundi","focus":"Haut","exercises":[{"name":"Developpe couche","sets":3,"reps":"10","rest_seconds":90}]},{"day":"Mercredi","focus":"Bas","exercises":[{"name":"Squat","sets":3,"reps":"12","rest_seconds":90}]},{"day":"Vendredi","focus":"Full","exercises":[{"name":"Souleve de terre","sets":3,"reps":"8","rest_seconds":120}]}],"tips":["Echauffement 10 minutes"]}`
      );
      content_json.training = r.json;
      totalTokens += r.tokens;
    }

    await supabaseRequest(`/programs?id=eq.${program.id}`, 'PATCH', { content_json, status: 'ready' });
    await supabaseRequest(`/workspaces?id=eq.${workspace_id}`, 'PATCH', { generations_used: workspace.generations_used + 1 });

    return res.status(200).json({ program_id: program.id, content_json });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
