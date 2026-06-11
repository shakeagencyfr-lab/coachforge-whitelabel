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
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Extraire proprement le JSON entre { et }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response');
  const clean = text.slice(start, end + 1);
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
      const prompt = `Tu es coach sportif expert. Genere un programme entrainement 12 semaines en JSON valide uniquement pour:
Nom: ${client.full_name}, Niveau: ${client.fitness_level || 'intermediaire'}, Objectif: ${client.goal || 'remise en forme'}
${client.available_days || 3} jours par semaine, ${client.session_duration_min || 60} min par seance
Equipement: ${client.equipment || 'salle de sport'}, Blessures: ${client.injuries || 'aucune'}

Reponds UNIQUEMENT avec ce JSON sans aucun texte avant ou apres:
{"program_title":"Programme 12 semaines","duration_weeks":12,"phases":[{"phase":1,"name":"Adaptation","weeks":"1-4","goal":"Adaptation musculaire","sessions":[{"day":"Lundi","focus":"Haut du corps","exercises":[{"name":"Developpe couche","sets":3,"reps":"10-12","rpe":7,"rest_seconds":90},{"name":"Tirage vertical","sets":3,"reps":"10-12","rpe":7,"rest_seconds":90}]}]},{"phase":2,"name":"Progression","weeks":"5-8","goal":"Progression des charges","sessions":[{"day":"Lundi","focus":"Haut du corps","exercises":[{"name":"Developpe couche","sets":4,"reps":"8-10","rpe":8,"rest_seconds":120}]}]},{"phase":3,"name":"Intensification","weeks":"9-12","goal":"Intensification maximale","sessions":[{"day":"Lundi","focus":"Full body","exercises":[{"name":"Squat","sets":4,"reps":"6-8","rpe":9,"rest_seconds":150}]}]}],"general_tips":["Bien vous echauffer avant chaque seance","Respectez les temps de repos"]}

Adapte ce JSON au profil du client en gardant exactement cette structure.`;
      const { json, tokens } = await callClaude(prompt);
      content_json.training = json;
      totalTokens += tokens;
    }

    if (type === 'nutrition' || type === 'combined') {
      const prompt = `Tu es nutritionniste expert. Genere un plan nutritionnel en JSON valide uniquement pour:
Nom: ${client.full_name}, Objectif: ${client.goal || 'remise en forme'}, Poids: ${client.weight_kg || 75}kg
Calories: ${client.daily_calories || 'a calculer'}, Preferences: ${client.dietary_preferences || 'omnivore'}

Reponds UNIQUEMENT avec ce JSON sans aucun texte avant ou apres:
{"plan_title":"Plan nutritionnel personnalise","daily_calories":2000,"macros":{"protein_g":150,"carbs_g":200,"fat_g":70},"meals":[{"name":"Petit dejeuner","time":"7h00","calories":500,"foods":[{"item":"Flocons avoine","quantity":"80g","calories":300},{"item":"Oeuf","quantity":"2 unites","calories":140}]},{"name":"Dejeuner","time":"12h30","calories":700,"foods":[{"item":"Poulet grille","quantity":"150g","calories":250},{"item":"Riz complet","quantity":"150g","calories":200}]},{"name":"Diner","time":"19h30","calories":600,"foods":[{"item":"Saumon","quantity":"150g","calories":280},{"item":"Legumes vapeur","quantity":"200g","calories":80}]}],"hydration_liters":2.5,"supplements":["Proteines whey si besoin"],"tips":["Mangez lentement","Hydratez vous regulierement"]}

Adapte ce JSON au profil du client en gardant exactement cette structure.`;
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
