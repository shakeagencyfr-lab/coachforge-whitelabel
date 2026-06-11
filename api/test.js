module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Lire le body manuellement
  let rawBody = '';
  await new Promise((resolve) => {
    req.on('data', chunk => rawBody += chunk);
    req.on('end', resolve);
  });

  return res.status(200).json({
    method: req.method,
    body_parsed: req.body,
    body_raw: rawBody,
    body_raw_length: rawBody.length,
    headers_content_type: req.headers['content-type'],
  });
};
