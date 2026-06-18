// ════════════════════════════════════════════════════════════
// CONSULTOR DE ESTADO (función normal, rápida)
// El navegador la llama para preguntar: "¿ya está lista la parte N?"
// Lee del guardadero (Netlify Blobs) y responde al instante.
// ════════════════════════════════════════════════════════════
const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { jobId, index } = body;

    if (!jobId || index === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'jobId e index requeridos' }) };
    }

    const store = getStore('simulacros');
    const key = `${jobId}/parte-${index}`;

    // getWithMetadata no lanza error si no existe: devuelve null.
    const result = await store.get(key, { type: 'json' });

    if (result === null) {
      // Todavía no está lista esta parte.
      return { statusCode: 200, headers, body: JSON.stringify({ listo: false }) };
    }

    // Ya está: devolvemos lo que guardó el motor (ok + text, o ok:false + error).
    return { statusCode: 200, headers, body: JSON.stringify({ listo: true, resultado: result }) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
