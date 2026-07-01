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
      const RANGE = 'Clientes!A:I';
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

      // ── CANDADO DE PAGO ──────────────────────────────────────────
      // Solo deja entrar si la columna H (Estado) dice "ACTIVO".
      // Tolerante a mayúsculas/minúsculas y espacios ("Activo", "ACTIVO ", etc.).
      // Si no está activo (vacío, "PENDIENTE", etc.), se bloquea el acceso.
      const estado = (userRow[7] || '').toLowerCase().trim();
      if (estado !== 'activo') {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'pago_pendiente', mensaje: 'Tu acceso está en revisión. Apenas confirmemos tu pago lo activamos (suele ser rápido).' }) };
      }
      // ─────────────────────────────────────────────────────────────

      const marcaTemporal = userRow[0] || '';
      const nombre = userRow[1] || 'Cliente';
      const cargo = userRow[4] || 'Cargo CNSC';
      const entidad = userRow[3] || '';   // columna D = Entidad registrada por el cliente

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
        body: JSON.stringify({ ok: true, nombre, cargo, entidad, email: userRow[2], activacion })
      };
    }

    // ── SEGURIDAD ────────────────────────────────────────────────
    // Este endpoint SOLO debe servir para el login (action:'auth').
    // Antes, esta rama recibía un "prompt" y llamaba DIRECTO a Anthropic
    // SIN pedir clave ni verificación → quedaba abierta: cualquiera podía
    // gastar tu saldo de Anthropic gratis. La app NO la usa (la generación
    // real va por save-prompt + generate-background), así que se bloquea.
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'no_autorizado' }) };
    // ─────────────────────────────────────────────────────────────

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
