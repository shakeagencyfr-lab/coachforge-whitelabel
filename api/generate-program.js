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
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.[0]?.text || '';
  // Extraire JSON
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
      const { json, tokens } = await callClaude(
        `Reponds avec UNIQUEMENT un objet JSON valide, rien d autre, pas de markdown, pas d explication.
Genere un programme fitness pour: niveau ${client.fitness_level || 'debutant'}, objectif ${client.goal || 'forme generale'}, ${client.available_days || 3} jours par semaine, equipement: ${client.equipment || 'salle de sport'}.
JSON requis:
{"program_title":"Programme Fitness 4 semaines","duration_weeks":4,"sessions":[{"day":"Lundi","focus":"Haut du corps","exercises":[{"name":"Developpe couche","sets":3,"reps":"10","rest_seconds":90},{"name":"Rowing haltere","sets":3,"reps":"10","rest_seconds":90},{"name":"Elevation laterale","sets":3,"reps":"12","rest_seconds":60}]},{"day":"Mercredi","focus":"Bas du corps","exercises":[{"name":"Squat","sets":3,"reps":"12","rest_seconds":90},{"name":"Fente","sets":3,"reps":"10","rest_seconds":90},{"name":"Leg curl","sets":3,"reps":"12","rest_seconds":60}]},{"day":"Vendredi","focus":"Full body","exercises":[{"name":"Soulevé de terre","sets":3,"reps":"8","rest_seconds":120},{"name":"Tractions","sets":3,"reps":"8","rest_seconds":90},{"name":"Gainage","sets":3,"reps":"30sec","rest_seconds":60}]}],"tips":["Echauffez vous 10 minutes","Hydratez vous pendant la seance"]}
Adapte les exercices au profil mais garde exactement cette structure JSON.`
      );
      content_json.training = json;
      totalTokens += tokens;
    }

    if (type === 'nutrition' || type === 'combined') {
      const { json, tokens } = await callClaude(
        `Reponds avec UNIQUEMENT un objet JSON valide, rien d autre, pas de markdown, pas d explication.
Genere un plan nutrition pour: objectif ${client.goal || 'forme generale'}, poids ${client.weight_kg || 75}kg, regime ${client.dietary_preferences || 'omnivore'}.
JSON requis:
{"plan_title":"Plan Nutrition Personnalise","daily_calories":2000,"macros":{"protein_g":150,"carbs_g":220,"fat_g":65},"meals":[{"name":"Petit-dejeuner","time":"7h00","calories":450,"foods":[{"item":"Flocons avoine","quantity":"80g","calories":300},{"item":"Banane","quantity":"1 piece","calories":90},{"item":"Oeuf dur","quantity":"1 piece","calories":80}]},{"name":"Dejeuner","time":"12h30","calories":650,"foods":[{"item":"Poulet grille","quantity":"150g","calories":250},{"item":"Riz complet","quantity":"120g","calories":160},{"item":"Legumes vapeur","quantity":"150g","calories":60}]},{"name":"Diner","time":"19h30","calories":550,"foods":[{"item":"Saumon","quantity":"130g","calories":270},{"item":"Patate douce","quantity":"150g","calories":130},{"item":"Salade verte","quantity":"100g","calories":20}]}],"tips":["Boire 2L d eau par jour","Manger lentement"]}
Adapte les calories et aliments au profil mais garde exactement cette structure JSON.`
      );
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
