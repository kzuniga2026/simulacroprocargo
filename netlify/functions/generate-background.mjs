// ════════════════════════════════════════════════════════════
// MOTOR DE GENERACIÓN EN SEGUNDO PLANO (Background Function)
// MEJORAS "PLAN B":
//   • Backoff CON JITTER (azar): los usuarios ya NO reintentan
//     sincronizados → se acaba el "efecto manada" en los picos.
//   • Más paciencia (6 intentos, hasta 60s c/u): la función
//     background aguanta 15 min, así casi ninguna parte se rinde.
//   • MEDIDOR: registra en los logs tu límite REAL de salida,
//     para que puedas leer tu techo verdadero (no estimaciones).
//   • Sigue respetando retry-after (igual que antes).
// ════════════════════════════════════════════════════════════
import { getStore } from '@netlify/blobs';

// Cuánto esperar antes de reintentar (en milisegundos).
// base = 5s, 10s, 20s, 40s, 60s, 60s...  pero con ±50% de AZAR (jitter),
// para que dos personas que chocan al tiempo NO reintenten al mismo segundo.
function calcularEspera(intento, retryAfterSeg) {
  const base = Math.min(5000 * Math.pow(2, intento - 1), 60000);
  const conJitter = Math.round(base * (0.5 + Math.random())); // entre 0.5x y 1.5x de la base
  if (retryAfterSeg && !isNaN(retryAfterSeg)) {
    // Si Anthropic nos dice cuánto esperar, lo respetamos como mínimo
    // y le sumamos un poquito de azar para desincronizar.
    return Math.max(conJitter, retryAfterSeg * 1000 + Math.round(Math.random() * 2000));
  }
  return conJitter;
}

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

  // ── Generar con la IA (reintentos PACIENTES con JITTER si hay saturación) ──
  const MAX_INTENTOS = 6;   // antes 4. La función background aguanta hasta 15 min.
  let ultimoError = 'desconocido';
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
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

      // 📊 MEDIDOR: tu techo REAL de salida (esto reemplaza la adivinanza del "80.000").
      //    Míralo en los logs durante la prueba de carga para conocer tu límite verdadero.
      const limOut = response.headers.get('anthropic-ratelimit-output-tokens-limit');
      const remOut = response.headers.get('anthropic-ratelimit-output-tokens-remaining');
      if (limOut || remOut) {
        console.log('BG LIMITE-SALIDA parte ' + index + ' → limite=' + limOut + ' restante=' + remOut);
      }

      if (response.ok) {
        const data = await response.json();
        const text = (data.content || []).map(function(c){ return c.text || ''; }).join('');
        await store.setJSON(key, { ok: true, text: text });
        console.log('BG OK guardó', key, 'len=', text.length, 'intento=', intento);
        return new Response('', { status: 202 });
      }

      // 429 = "vas muy rápido", 529/500/503 = servidor saturado → ESPERAR (con jitter) y reintentar
      if (response.status === 429 || response.status === 529 || response.status === 500 || response.status === 503) {
        const ra = parseInt(response.headers.get('retry-after'));
        const espera = calcularEspera(intento, ra);
        ultimoError = 'anthropic_' + response.status;
        console.log('BG SATURADO ' + response.status + ' parte ' + index + ' — espera ' + espera + 'ms (intento ' + intento + '/' + MAX_INTENTOS + ')');
        if (intento < MAX_INTENTOS) { await new Promise(function(r){ setTimeout(r, espera); }); continue; }
      } else {
        // Otro error (no de saturación): registrar y no insistir
        let cuerpo = '';
        try { cuerpo = JSON.stringify(await response.json()); } catch (_) {}
        console.log('BG ANTHROPIC ERROR:', response.status, cuerpo);
        ultimoError = 'anthropic_' + response.status;
        break;
      }
    } catch (error) {
      ultimoError = error.message;
      console.log('BG CATCH ERROR (intento ' + intento + '): ' + error.message);
      if (intento < MAX_INTENTOS) { await new Promise(function(r){ setTimeout(r, calcularEspera(intento, null)); }); continue; }
    }
  }

  // Si llegó hasta aquí, no se logró tras los intentos pacientes
  try {
    await store.setJSON(key, { ok: false, error: ultimoError });
  } catch (e2) {
    console.log('BG no pudo guardar el error:', e2.message);
  }
  return new Response('', { status: 202 });
};

export const config = {
  background: true
};
