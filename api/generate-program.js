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
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found: ' + text.slice(0, 200));
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
      const prompt = `Tu es coach sportif expert. Genere un programme entrainement personnalise en JSON valide pour ce client:
- Nom: ${client.full_name}
- Niveau: ${client.fitness_level || 'intermediaire'}
- Objectif: ${client.goal || 'remise en forme'}
- Jours par semaine: ${client.available_days || 3}
- Duree seance: ${client.session_duration_min || 60} min
- Equipement: ${client.equipment || 'salle de sport'}
- Blessures: ${client.injuries || 'aucune'}

IMPORTANT: Reponds UNIQUEMENT avec du JSON valide. Pas de texte avant ou apres. Pas de markdown.
Structure exacte a respecter (3 phases de 4 semaines, ${client.available_days || 3} seances par phase):

{"program_title":"...","duration_weeks":12,"phases":[{"phase":1,"name":"...","weeks":"1-4","goal":"...","sessions":[{"day":"...","focus":"...","exercises":[{"name":"...","sets":3,"reps":"10-12","rpe":7,"rest_seconds":90}]}]}],"general_tips":["..."]}`;

      const { json, tokens } = await callClaude(prompt);
      content_json.training = json;
      totalTokens += tokens;
    }

    if (type === 'nutrition' || type === 'combined') {
      const prompt = `Tu es nutritionniste expert. Genere un plan nutritionnel personnalise en JSON valide pour ce client:
- Nom: ${client.full_name}
- Objectif: ${client.goal || 'remise en forme'}
- Poids: ${client.weight_kg || 75}kg, Taille: ${client.height_cm || 170}cm
- Calories cibles: ${client.daily_calories || 'a calculer selon le profil'}
- Preferences: ${client.dietary_preferences || 'omnivore'}
- Allergies: ${client.allergies || 'aucune'}

IMPORTANT: Reponds UNIQUEMENT avec du JSON valide. Pas de texte avant ou apres. Pas de markdown.
Structure exacte a respecter (4 repas par jour):

{"plan_title":"...","daily_calories":2000,"macros":{"protein_g":150,"carbs_g":200,"fat_g":70},"meals":[{"name":"Petit dejeuner","time":"7h00","calories":500,"foods":[{"item":"...","quantity":"...","calories":200}]},{"name":"Dejeuner","time":"12h30","calories":700,"foods":[{"item":"...","quantity":"...","calories":300}]},{"name":"Collation","time":"16h00","calories":300,"foods":[{"item":"...","quantity":"...","calories":150}]},{"name":"Diner","time":"19h30","calories":500,"foods":[{"item":"...","quantity":"...","calories":250}]}],"hydration_liters":2.5,"supplements":["..."],"tips":["..."]}`;

      const { json, tokens } = await callClaude(prompt);
      content_json.nutrition = json;
      totalTokens += tokens;
    }

    await supabaseRequest(`/programs?id=eq.${program.id}`, 'PATCH', { content_json, status: 'ready' });
    await supabaseRequest(`/workspaces?id=eq.${workspace_id}`, 'PATCH', { generations_used: workspace.generations_used + 1 });
    await supabaseRequest('/generation_logs', 'POST', {
      workspace_id, program_id: program.id, tokens_used: totalTokens,
      model: 'claude-3-5-sonnet-20241022', status: 'success'
    });

    return res.status(200).json({ program_id: program.id, content_json });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
