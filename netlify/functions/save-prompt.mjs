// ════════════════════════════════════════════════════════════
// GUARDA EL PROMPT EN EL GUARDADERO (función NORMAL y rápida)
// Ahora con "foco": avisa en los logs si guardó o si falló.
// ════════════════════════════════════════════════════════════
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.log('SAVE ERROR: body invalido:', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'body invalido' }), { status: 400, headers });
  }

  const jobId  = body.jobId;
  const index  = body.index;
  const prompt = body.prompt;

  // ── CANDADO: guardar el SIMULACRO COMPLETO (las 160 preguntas ya armadas) ──
  // Se llama una vez al terminar la generación. Así, cuando el cliente vuelve
  // a entrar con su misma clave, se le muestra ESTE simulacro sin regenerar.
  if (body.accion === 'guardar_simulacro') {
    if (!jobId || !Array.isArray(body.questions) || body.questions.length === 0) {
      console.log('SAVE SIMULACRO ERROR: faltan datos | jobId=' + jobId);
      return new Response(JSON.stringify({ ok: false, error: 'faltan datos del simulacro' }), { status: 400, headers });
    }
    try {
      const store = getStore({ name: 'simulacros', consistency: 'strong' });
      await store.setJSON(jobId + '/parte-completo', { ok: true, questions: body.questions });
      console.log('SAVE SIMULACRO OK guardó', jobId, 'preguntas=', body.questions.length);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    } catch (error) {
      console.log('SAVE SIMULACRO ERROR al guardar', jobId, ':', error.message);
      return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers });
    }
  }

  if (!jobId || index === undefined || index === null || !prompt) {
    console.log('SAVE ERROR: faltan datos | jobId=' + jobId + ' index=' + index + ' promptLen=' + (prompt ? prompt.length : 0));
    return new Response(JSON.stringify({ ok: false, error: 'faltan datos' }), { status: 400, headers });
  }

  const promptKey = jobId + '/prompt-' + index;

  try {
    const store = getStore({ name: 'simulacros', consistency: 'strong' });
    await store.setJSON(promptKey, { prompt: prompt });
    console.log('SAVE OK guardó', promptKey, 'promptLen=', prompt.length);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    console.log('SAVE ERROR al guardar', promptKey, ':', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers });
  }
};
