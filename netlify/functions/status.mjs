// ════════════════════════════════════════════════════════════
// CONSULTOR DE ESTADO (función normal, rápida) — API MODERNA
// El navegador la llama para preguntar: "¿ya está lista la parte N?"
//
// consistency: 'strong'  →  ve los resultados apenas el motor
// los guarda, sin esperar la propagación.
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
    return new Response(JSON.stringify({ error: 'body inválido' }), { status: 400, headers });
  }

  const jobId = body.jobId;
  const index = body.index;

  if (!jobId || index === undefined || index === null) {
    return new Response(JSON.stringify({ error: 'jobId e index requeridos' }), { status: 400, headers });
  }

  try {
    const store = getStore({ name: 'simulacros', consistency: 'strong' });
    const key = jobId + '/parte-' + index;
    const result = await store.get(key, { type: 'json' });

    if (result === null) {
      return new Response(JSON.stringify({ listo: false }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ listo: true, resultado: result }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
