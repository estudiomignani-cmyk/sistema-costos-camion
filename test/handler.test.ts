/** Tests del endpoint web del agente (streaming NDJSON) con un modelo simulado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { crearHandler } from '../src/web/handler';
import { parametrosDesdePlanilla } from '../src/costos/planilla';
import { calcular, PARAMETROS_POR_DEFECTO } from '../src/costos/modelo';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const llamada = (toolName: string, input: object) => ({
  content: [{ type: 'tool-call' as const, toolCallId: toolName, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: 'STOP' }, usage, warnings: [],
});
const texto = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: 'STOP' }, usage, warnings: [],
});

/** Estado igual al que arma la planilla con los valores de ejemplo. */
const estado = {
  params: {
    'p-km': '10080', 'p-viajes': '12', 'p-tn': '30', 'p-tarifa': '1283',
    'q-del': '2', 'pr-del': '580438', 'vu-del': '120000', 'q-trac': '4', 'pr-trac': '530000', 'vu-trac': '120000',
    'q-acop': '12', 'pr-acop': '506368', 'vu-acop': '100000', 'p-repuestos': '100000',
    'pr-gasoil': '1366', 'cons-gasoil': '30.7',
  },
  fijos: PARAMETROS_POR_DEFECTO.fijos.map(f => ({ c: f.concepto, q: 1, u: 'mes', i: f.importe })),
  vars: [{ c: 'Gasoil', q: 0, u: 'lts', i: 0, key: 'gasoil' }, { c: 'Lavado', q: 1, u: 'mes', i: 50000, key: 'manual_1' }],
  aceites: PARAMETROS_POR_DEFECTO.aceites.map(a => ({ c: a.concepto, cap: a.capacidadLts, pr: a.precioLt, vu: a.vidaUtilKm })),
  filtros: PARAMETROS_POR_DEFECTO.filtros.map(f => ({ c: f.concepto, cant: f.cantidad, pr: f.precio, vu: f.vidaUtilKm })),
};

const pedir = (handler: ReturnType<typeof crearHandler>, body: unknown) =>
  handler(new Request('http://x/api/agente', { method: 'POST', body: JSON.stringify(body) }));
const eventos = async (r: Response) => (await r.text()).trim().split('\n').map(l => JSON.parse(l));

test('la planilla se convierte al modelo, incluidos los variables manuales', () => {
  const p = parametrosDesdePlanilla(estado);
  const r = calcular(p);
  assert.equal(r.totalCostos, calcular(PARAMETROS_POR_DEFECTO).totalCostos + 50000);
  assert.deepEqual(p.otrosVariables, [{ concepto: 'Lavado', importe: 50000 }]);
});

test('transmite pasos, cambios y respuesta final usando los datos de la planilla', async () => {
  const modelo = new MockLanguageModelV4({
    doGenerate: [
      llamada('calcular_costos', {}),
      llamada('actualizar_parametros', { cambios: { precioGasoil: 1800 } }),
      texto('Listo, **actualicé** el gasoil.'),
    ],
  });
  const r = await pedir(crearHandler({ modelo: () => modelo }), {
    mensajes: [{ rol: 'usuario', texto: 'hola' }, { rol: 'asistente', texto: 'hola!' }, { rol: 'usuario', texto: 'poné el gasoil a 1800' }],
    estado,
  });
  assert.equal(r.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  const ev = await eventos(r);
  assert.deepEqual(ev.map(e => e.tipo), ['paso', 'paso', 'paso', 'cambios', 'final']);
  assert.equal(ev[0].acciones[0].tool, 'calcular_costos');
  assert.equal(ev[0].acciones[0].output.totalCostos, calcular(PARAMETROS_POR_DEFECTO).totalCostos + 50000);
  assert.deepEqual(ev[3].cambios, [{ precioGasoil: 1800 }]);
  assert.equal(ev[4].respuesta, 'Listo, **actualicé** el gasoil.');
  // El historial previo llega al modelo
  assert.match(JSON.stringify(modelo.doGenerateCalls[0].prompt), /hola!/);
});

test('rechaza pedidos inválidos y métodos distintos de POST', async () => {
  const h = crearHandler({ modelo: () => new MockLanguageModelV4() });
  assert.equal((await pedir(h, { mensajes: [] })).status, 400);
  assert.equal((await pedir(h, { mensajes: [{ rol: 'asistente', texto: 'x' }], estado })).status, 400);
  assert.equal((await h(new Request('http://x/api/agente'))).status, 405);
});

test('si el modelo falla, emite un evento de error', async () => {
  const modelo = new MockLanguageModelV4({ doGenerate: () => Promise.reject(new Error('boom')) });
  const origError = console.error; console.error = () => {};
  try {
    const ev = await eventos(await pedir(crearHandler({ modelo: () => modelo }), { mensajes: [{ rol: 'usuario', texto: 'x' }], estado }));
    assert.equal(ev.at(-1).tipo, 'error');
  } finally { console.error = origError; }
});

test('sin API key ni modelo inyectado responde 500 con un mensaje claro', async () => {
  const prev = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  try {
    const r = await pedir(crearHandler(), { mensajes: [{ rol: 'usuario', texto: 'x' }], estado });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /GOOGLE_GENERATIVE_AI_API_KEY/);
  } finally { if (prev !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prev; }
});
