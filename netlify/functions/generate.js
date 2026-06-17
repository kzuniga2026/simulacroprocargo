exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(event.body);

    if (body.action === 'auth') {
      const { email, pass } = body;
      if (!email || !pass) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Credenciales requeridas' }) };
      }

      const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const token = await getAccessToken(serviceAccount);

      const SHEET_ID = process.env.GOOGLE_SHEET_ID;
      const RANGE = 'Respuestas de formulario 1!A:I';
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`;

      const sheetResp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const sheetData = await sheetResp.json();
      const rows = sheetData.values || [];

      const emailLower = email.toLowerCase().trim();
      const passClean = pass.trim();

      console.log('Total rows:', rows.length);
      console.log('Buscando email:', emailLower, 'pass:', passClean);
      rows.slice(1).forEach((row, i) => {
        console.log(`Fila ${i+2}: email="${(row[2]||'').toLowerCase().trim()}" pass="${(row[6]||'').trim()}"`);
      });

      const userRow = rows.slice(1).find(row => {
        const rowEmail = (row[2] || '').toLowerCase().trim();
        const rowPass = (row[6] || '').trim();
        return rowEmail === emailLower && rowPass === passClean;
      });

      if (!userRow) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Correo o clave incorrectos' }) };
      }

      const marcaTemporal = userRow[0] || '';
      const nombre = userRow[1] || 'Cliente';
      const cargo = userRow[4] || 'Cargo CNSC';

      let activacion = null;
      if (marcaTemporal) {
        const partes = marcaTemporal.split(' ')[0].split('/');
        if (partes.length === 3) {
          activacion = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, nombre, cargo, email: userRow[2], activacion })
      };
    }

    const { prompt } = body;
    if (!prompt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Prompt requerido' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 32000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${base64Header}.${base64Payload}`;

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const jwt = `${signingInput}.${signature}`;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenResp.json();
  return tokenData.access_token;
}
