// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// Ahora con "foco": si no encuentra el prompt, muestra en los
// logs qué claves SÍ existen en el guardadero para este trabajo.
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
  const promptKey = jobId + '/prompt-' + index;
  const key       = jobId + '/parte-' + index;

  // ── Recoger el prompt del guardadero ──
  let prompt;
  try {
    const saved = await store.get(promptKey, { type: 'json' });
    prompt = saved && saved.prompt;
  } catch (e) {
    console.log('BG ERROR: no se pudo leer el prompt de Blobs:', e.message);
  }

  if (!prompt) {
    // FOCO: ¿qué claves existen realmente en el guardadero para este trabajo?
    let claves = '(no se pudo listar)';
    try {
      const lista = await store.list({ prefix: jobId + '/' });
      claves = JSON.stringify((lista.blobs || []).map(function(b){ return b.key; }));
    } catch (e) {
      claves = 'ERROR list: ' + e.message;
    }
    console.log('BG ERROR: prompt no encontrado | buscaba=' + promptKey + ' | claves existentes=' + claves);
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
