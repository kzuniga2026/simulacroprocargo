// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// API MODERNA de Netlify: export default + req.json()
// Puede correr hasta 15 minutos.
//
// Recibe solo { jobId, index } y LEE el prompt del guardadero
// (lo dejó antes la función save-prompt). Luego genera con la IA
// y guarda el resultado en el guardadero (Netlify Blobs).
//
// consistency: 'strong'  →  garantiza encontrar el prompt
// recién guardado, sin esperas ni "no encontrado".
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

  const jobId = payload.jobId;
  const index = payload.index;

  if (!jobId || index === undefined || index === null) {
    console.log('BG ERROR: faltan jobId/index | jobId=' + jobId + ' index=' + index);
    return new Response('', { status: 202 });
  }

  const store     = getStore({ name: 'simulacros', consistency: 'strong' });
  const promptKey = jobId + '/prompt-' + index;   // de aquí LEE el prompt
  const key       = jobId + '/parte-' + index;    // aquí GUARDA el resultado

  // ── Recoger el prompt del guardadero ──
  let prompt;
  try {
    const saved = await store.get(promptKey, { type: 'json' });
    prompt = saved && saved.prompt;
  } catch (e) {
    console.log('BG ERROR: no se pudo leer el prompt de Blobs:', e.message);
  }

  if (!prompt) {
    console.log('BG ERROR: prompt vacio o no encontrado | promptKey=' + promptKey + ' promptLen=' + (prompt ? prompt.length : 0));
    await store.setJSON(key, { ok: false, error: 'prompt_no_encontrado' });
    return new Response('', { status: 202 });
  }

  // ── Generar con la IA ──
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
