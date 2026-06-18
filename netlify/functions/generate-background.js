// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// Puede correr hasta 15 minutos. Recibe UN prompt (un bloque),
// lo genera con la IA, y guarda el resultado en Netlify Blobs.
// ════════════════════════════════════════════════════════════
const { getStore } = require('@netlify/blobs');

// Lee el cuerpo de la petición de forma robusta. Las funciones background
// de Netlify a veces entregan el body distinto a las normales, así que
// intentamos varias formas para ser tolerantes.
async function leerBody(req, event) {
  // 1) Formato "moderno" (req es un Request web con .json())
  if (req && typeof req.json === 'function') {
    try {
      return await req.json();
    } catch (e) { /* sigue intentando */ }
  }
  // 2) Formato "clásico" (event.body como string)
  if (event && typeof event.body === 'string' && event.body.length) {
    try {
      return JSON.parse(event.body);
    } catch (e) { /* sigue intentando */ }
  }
  // 3) event.body ya como objeto
  if (event && event.body && typeof event.body === 'object') {
    return event.body;
  }
  return null;
}

exports.handler = async function(event) {
  const payload = await leerBody(event, event);

  if (!payload) {
    console.log('BG ERROR: no se pudo leer el body');
    return { statusCode: 202 };
  }

  const jobId  = payload.jobId;
  const index  = payload.index;
  const prompt = payload.prompt;

  if (!jobId || index === undefined || index === null || !prompt) {
    console.log('BG ERROR: faltan datos | jobId=' + jobId + ' index=' + index + ' promptLen=' + (prompt ? prompt.length : 0));
    return { statusCode: 202 };
  }

  const store = getStore('simulacros');
  const key = jobId + '/parte-' + index;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log('BG ANTHROPIC ERROR:', response.status, JSON.stringify(data));
      await store.setJSON(key, { ok: false, error: 'anthropic_' + response.status });
      return { statusCode: 202 };
    }

    const text = (data.content || []).map(function(c){ return c.text || ''; }).join('');
    await store.setJSON(key, { ok: true, text: text });
    console.log('BG OK guardó', key, 'len=', text.length);

  } catch (error) {
    console.log('BG CATCH ERROR:', error.message);
    try {
      await store.setJSON(key, { ok: false, error: error.message });
    } catch (e2) {
      console.log('BG no pudo guardar el error:', e2.message);
    }
  }

  return { statusCode: 202 };
};
