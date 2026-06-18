// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// Puede correr hasta 15 minutos (no se corta a los 10s como las normales).
// Recibe UN prompt (un bloque de preguntas), lo genera con la IA,
// y guarda el resultado en el guardadero (Netlify Blobs).
// El navegador NO espera esta respuesta: consulta el guardadero con status.js.
// ════════════════════════════════════════════════════════════
const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  // Las background functions solo responden 202 (encolado). El trabajo real
  // ocurre aquí y el resultado se deja en el guardadero.
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.log('BG ERROR: body inválido', e.message);
    return { statusCode: 202 };
  }

  const { jobId, index, prompt } = payload;

  if (!jobId || index === undefined || !prompt) {
    console.log('BG ERROR: faltan datos', JSON.stringify({ jobId, index, tienePrompt: !!prompt }));
    return { statusCode: 202 };
  }

  const store = getStore('simulacros');
  const key = `${jobId}/parte-${index}`;

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

    const text = (data.content || []).map(c => c.text || '').join('');
    // Guardamos el texto crudo de la IA. El navegador lo parsea y auto-corrige,
    // igual que hacía antes (esa lógica no cambia).
    await store.setJSON(key, { ok: true, text });
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
