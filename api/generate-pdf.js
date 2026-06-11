const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MARKUPGO_API_KEY = process.env.MARKUPGO_API_KEY;

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

function buildHtml(program, client, workspace) {
  const color = workspace.primary_color || '#7c3aed';
  const secondary = workspace.secondary_color || '#00d4a8';
  const training = program.content_json?.training;
  const nutrition = program.content_json?.nutrition;

  const trainingHtml = training ? `
    <h2 style="color:${color}">🏋️ ${training.program_title}</h2>
    ${(training.phases || []).map(phase => `
      <h3 style="background:${color};color:white;padding:8px 16px;border-radius:6px">
        Phase ${phase.phase} — ${phase.name} (Semaines ${phase.weeks})
      </h3>
      <p><strong>Objectif :</strong> ${phase.goal}</p>
      ${(phase.sessions || []).map(session => `
        <h4 style="color:${secondary}">${session.day} — ${session.focus}</h4>
        <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px">
          <tr style="background:#f5f5f5"><th>Exercice</th><th>Séries</th><th>Reps</th><th>RPE</th><th>Repos</th></tr>
          ${(session.exercises || []).map(ex => `
            <tr style="border-bottom:1px solid #eee">
              <td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rpe}/10</td><td>${ex.rest_seconds}s</td>
            </tr>
          `).join('')}
        </table>
      `).join('')}
    `).join('')}
  ` : '';

  const nutritionHtml = nutrition ? `
    <h2 style="color:${color};margin-top:40px">🥗 ${nutrition.plan_title}</h2>
    <table width="100%" cellpadding="12" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td align="center" style="border:2px solid ${color};border-radius:8px"><strong style="font-size:20px">${nutrition.daily_calories}</strong><br>Calories</td>
        <td align="center" style="border:2px solid ${color};border-radius:8px"><strong style="font-size:20px">${nutrition.macros?.protein_g}g</strong><br>Protéines</td>
        <td align="center" style="border:2px solid ${color};border-radius:8px"><strong style="font-size:20px">${nutrition.macros?.carbs_g}g</strong><br>Glucides</td>
        <td align="center" style="border:2px solid ${color};border-radius:8px"><strong style="font-size:20px">${nutrition.macros?.fat_g}g</strong><br>Lipides</td>
      </tr>
    </table>
    ${(nutrition.meals || []).map(meal => `
      <h4 style="color:${secondary}">${meal.name} — ${meal.time} (${meal.calories} kcal)</h4>
      <ul>${(meal.foods || []).map(f => `<li>${f.item} — ${f.quantity} (${f.calories} kcal)</li>`).join('')}</ul>
    `).join('')}
  ` : '';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <style>body{font-family:Arial,sans-serif;padding:40px;color:#1a1a2e;font-size:13px}h2{margin-top:32px}h4{margin:16px 0 8px}ul{padding-left:20px}li{padding:3px 0}</style>
  </head><body>
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${color};padding-bottom:20px;margin-bottom:32px">
      <div style="font-size:22px;font-weight:800;color:${color}">${workspace.name}</div>
      <div style="text-align:right"><strong>${client.full_name}</strong><br><small>Programme du ${new Date().toLocaleDateString('fr-FR')}</small></div>
    </div>
    ${trainingHtml}
    ${nutritionHtml}
    <div style="margin-top:48px;padding-top:16px;border-top:1px solid #eee;text-align:center;color:#999;font-size:11px">
      Programme confidentiel généré par ${workspace.name}
    </div>
  </body></html>`;
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

    const clients = await supabaseRequest(`/clients?id=eq.${program.client_id}`);
    const workspaces = await supabaseRequest(`/workspaces?id=eq.${program.workspace_id}`);
    const html = buildHtml(program, clients[0], workspaces[0]);

    const pdfRes = await fetch('https://api.markupgo.com/api/v1/pdf/from/html', {
      method: 'POST',
      headers: { 'x-api-key': MARKUPGO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { html },
        options: { format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, printBackground: true }
      }),
    });

    const pdfData = await pdfRes.json();
    const pdf_url = pdfData.url;
    if (!pdf_url) throw new Error('MarkupGo did not return a PDF URL');

    await supabaseRequest(`/programs?id=eq.${program_id}`, 'PATCH', { pdf_url, pdf_generated_at: new Date().toISOString() });

    return res.status(200).json({ pdf_url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
