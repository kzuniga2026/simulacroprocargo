// ════════════════════════════════════════════════════════════
// GUARDA EL PROMPT EN EL GUARDADERO (función NORMAL y rápida)
// El navegador la llama ANTES de disparar el motor de fondo.
// Motivo: las funciones normales SÍ reciben bien el body POST;
// las "background" NO reciben los datos largos. Por eso aquí
// guardamos el prompt y el motor de fondo solo recibirá
// { jobId, index } y leerá el prompt desde este guardadero.
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
    return new Response(JSON.stringify({ ok: false, error: 'body invalido' }), { status: 400, headers });
  }

  const jobId  = body.jobId;
  const index  = body.index;
  const prompt = body.prompt;

  if (!jobId || index === undefined || index === null || !prompt) {
    return new Response(JSON.stringify({ ok: false, error: 'faltan datos', promptLen: prompt ? prompt.length : 0 }), { status: 400, headers });
  }

  try {
    const store = getStore('simulacros');
    const promptKey = jobId + '/prompt-' + index;
    await store.setJSON(promptKey, { prompt: prompt });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers });
  }
};
