// ════════════════════════════════════════════════════════════
// VERIFICADOR DE COHERENCIA CON IA (función NORMAL)
// Revisa un tramo de preguntas de un simulacro YA GUARDADO y dice,
// para cada una, qué opción defiende realmente la sustentación.
//
// SEGURIDAD (para no abrir otra puerta a tu saldo de Anthropic):
//   • NO acepta preguntas ni prompts del navegador. Lee las preguntas
//     del guardadero (Blobs) con el jobId; si ese simulacro no existe → 403.
//   • Tope de llamadas por simulacro (MAX_LLAMADAS). Pasado el tope → 429.
//   • Máximo TRAMO_MAX preguntas por llamada.
// ════════════════════════════════════════════════════════════
import { getStore } from '@netlify/blobs';

const MODELOS = ['claude-haiku-5-5', 'claude-sonnet-4-5']; // si el 1º no está disponible, usa el 2º
const TRAMO_MAX = 15;
const MAX_LLAMADAS = 40;  // 156 preguntas / 12 por tramo ≈ 13 llamadas; margen para reintentos

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};
const resp = (status, obj) => new Response(JSON.stringify(obj), { status, headers });

function armarPrompt(qs) {
  const bloques = qs.map(function (q) {
    return [
      'ID ' + q.id,
      'ENUNCIADO: ' + q.enunciado,
      'A) ' + q.opciones.A,
      'B) ' + q.opciones.B,
      'C) ' + q.opciones.C,
      'D) ' + q.opciones.D,
      'SUSTENTACIÓN: ' + q.sustentacion
    ].join('\n');
  }).join('\n\n-----\n\n');

  return 'Eres revisor de calidad de un simulacro de concurso público colombiano (CNSC).\n' +
    'Para cada pregunta, lee la SUSTENTACIÓN e identifica qué opción (A, B, C o D) describe ' +
    'realmente el procedimiento o la conclusión que la sustentación DEFIENDE como correcta.\n' +
    'IMPORTANTE: IGNORA la letra que la sustentación escribe ("la respuesta correcta es X"), ' +
    'porque a veces está equivocada. Fíjate en el CONTENIDO: qué acciones, condiciones y orden ' +
    'propone la sustentación, y cuál opción coincide con eso. Si la sustentación descarta ' +
    'explícitamente una opción, esa no es.\n' +
    'Si no puedes determinarlo con seguridad, responde null para esa pregunta.\n\n' +
    bloques +
    '\n\nRESPONDE SOLO con JSON válido, sin texto adicional, con este formato exacto:\n' +
    '[{"id":<numero>,"defiende":"A"|"B"|"C"|"D"|null,"seguro":true|false}]';
}

async function llamarIA(prompt) {
  let ultimo = '';
  for (const modelo of MODELOS) {
    for (let intento = 1; intento <= 3; intento++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: modelo, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
      });
      if (r.ok) {
        const data = await r.json();
        return (data.content || []).map(function (c) { return c.text || ''; }).join('');
      }
      ultimo = 'anthropic_' + r.status;
      if (r.status === 404 || r.status === 400) break;          // modelo no disponible → probar el siguiente
      if ([429, 500, 503, 529].includes(r.status)) {             // saturado → esperar y reintentar
        await new Promise(function (ok) { setTimeout(ok, 1500 * intento + Math.random() * 1000); });
        continue;
      }
      throw new Error(ultimo);
    }
  }
  throw new Error(ultimo || 'sin_respuesta');
}

function extraerArreglo(texto) {
  let t = String(texto || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = t.indexOf('['), f = t.lastIndexOf(']');
  if (i !== -1 && f > i) t = t.substring(i, f + 1);
  return JSON.parse(t);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return resp(405, { ok: false, error: 'metodo' });

  let body;
  try { body = await req.json(); } catch (e) { return resp(400, { ok: false, error: 'body invalido' }); }

  const jobId = body.jobId;
  const desde = parseInt(body.desde, 10);
  const hasta = parseInt(body.hasta, 10);
  if (!jobId || typeof jobId !== 'string' || isNaN(desde) || isNaN(hasta) || hasta < desde || (hasta - desde + 1) > TRAMO_MAX) {
    return resp(400, { ok: false, error: 'parametros' });
  }

  const store = getStore({ name: 'simulacros', consistency: 'strong' });

  // 1) El simulacro debe existir en el guardadero (si no, nadie puede usar esta función)
  let guardado = null;
  try { guardado = await store.get(jobId + '/parte-completo', { type: 'json' }); } catch (e) {}
  if (!guardado || !guardado.ok || !Array.isArray(guardado.questions) || guardado.questions.length === 0) {
    return resp(403, { ok: false, error: 'no_autorizado' });
  }

  // 2) Tope de uso por simulacro
  const usoKey = jobId + '/verif-uso';
  let uso = 0;
  try { const u = await store.get(usoKey, { type: 'json' }); uso = (u && u.n) || 0; } catch (e) {}
  if (uso >= MAX_LLAMADAS) {
    console.log('VERIF tope alcanzado', jobId);
    return resp(429, { ok: false, error: 'tope' });
  }
  try { await store.setJSON(usoKey, { n: uso + 1 }); } catch (e) {}

  // 3) Tomar las preguntas del tramo DESDE EL GUARDADERO (no del navegador)
  //    Se trabaja por POSICIÓN (1..N tras ordenar por id), igual que la app
  //    renumera al mostrar, así los números coinciden aunque haya saltos guardados.
  const ordenadas = guardado.questions.slice().sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
  const qs = ordenadas.slice(desde - 1, hasta).map(function (q, i) {
    return Object.assign({}, q, { id: desde + i });
  }).filter(function (q) { return q && q.opciones && q.sustentacion; });
  if (qs.length === 0) return resp(200, { ok: true, veredictos: [] });

  try {
    const texto = await llamarIA(armarPrompt(qs));
    const arr = extraerArreglo(texto);
    const veredictos = (Array.isArray(arr) ? arr : []).filter(function (v) {
      return v && typeof v.id === 'number' && ['A', 'B', 'C', 'D'].includes(v.defiende) && v.seguro === true;
    }).map(function (v) { return { id: v.id, defiende: v.defiende }; });
    console.log('VERIF OK', jobId, desde + '-' + hasta, 'veredictos=', veredictos.length);
    return resp(200, { ok: true, veredictos: veredictos });
  } catch (e) {
    console.log('VERIF ERROR', jobId, desde + '-' + hasta, e.message);
    return resp(502, { ok: false, error: e.message });
  }
};
