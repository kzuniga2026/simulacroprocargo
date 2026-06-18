// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// API MODERNA de Netlify: export default + req.json()
// Puede correr hasta 15 minutos. Recibe UN prompt (un bloque),
// lo genera con la IA, y guarda el resultado en Netlify Blobs.
// ════════════════════════════════════════════════════════════
import { getStore } from '@netlify/blobs';

export default async (req) => {
  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    console.log('BG ERROR: no se pudo leer JSON del body:', e.message);
    return new Response('', { status: 202 });
  }

  const jobId  = payload.jobId;
  const index  = payload.index;
  const prompt = payload.prompt;

  if (!jobId || index === undefined || index === null || !prompt) {
    console.log('BG ERROR: faltan datos | jobId=' + jobId + ' index=' + index + ' promptLen=' + (prompt ? prompt.length : 0));
    return new Response('', { status: 202 });
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
      return new Response('', { status: 202 });
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

  return new Response('', { status: 202 });
};

export const config = {
  background: true
};
