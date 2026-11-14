/**
 * Tests del ciclo ReAct sin llamar a Gemini: un modelo simulado (MockLanguageModelV4)
 * responde paso a paso con llamadas a tools y, al final, con texto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { crearAgente } from '../src/agente/agente';
import { calcular, PARAMETROS_POR_DEFECTO, tarifaDeEquilibrio } from '../src/costos/modelo';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const llamada = (id: string, toolName: string, input: object) => ({
  content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: 'STOP' },
  usage, warnings: [],
});
const texto = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: 'STOP' },
  usage, warnings: [],
});

test('modelo de costos replica index.html', () => {
  const r = calcular(PARAMETROS_POR_DEFECTO);
  assert.equal(r.totalFijos, 1_075_000);
  assert.equal(r.litrosGasoil, 3095);           // 10080 km × 30,7 / 100
  assert.equal(r.toneladasMes, 360);
  assert.equal(r.ingresos, 461_880);            // 360 tn × $1283
  assert.equal(r.items.find(i => i.categoria === 'sueldo')!.importe, 83_138);
  const eq = tarifaDeEquilibrio(PARAMETROS_POR_DEFECTO)!;
  const enEquilibrio = calcular({ ...PARAMETROS_POR_DEFECTO, tarifaPorTn: eq });
  assert.ok(Math.abs(enEquilibrio.resultadoMensual) < 2);
});

test('ciclo ReAct: razona → actúa → observa → repite → responde', async () => {
  const pasos: string[] = [];
  const modelo = new MockLanguageModelV4({
    doGenerate: [
      llamada('1', 'calcular_costos', {}),
      llamada('2', 'calculadora', { expresion: '2 * 3' }),
      texto('El costo total mensual es X.'),
    ],
  });
  const agente = crearAgente({
    modelo,
    onPaso: (p, n) => { pasos.push(`${n}:${p.toolCalls.map(c => c.toolName).join(',') || 'final'}`); },
  });

  const { respuesta, pasos: steps, agotoPasos } = await agente.preguntar('¿Cuánto me cuesta el camión por mes?');

  assert.equal(respuesta, 'El costo total mensual es X.');
  assert.deepEqual(pasos, ['1:calcular_costos', '2:calculadora', '3:final']);
  assert.equal(agotoPasos, false);
  // La observación del paso 1 es el resultado real de la tool
  const obs = steps[0].toolResults[0].output as { totalFijos: number };
  assert.equal(obs.totalFijos, 1_075_000);
  assert.deepEqual(steps[1].toolResults[0].output, { expresion: '2 * 3', resultado: 6 });
  // En el paso 2 el modelo recibió la observación del paso 1 en el prompt
  const prompt2 = JSON.stringify(modelo.doGenerateCalls[1].prompt);
  assert.match(prompt2, /totalFijos/);
  // Memoria: user + (assistant, tool) × 2 + assistant final
  assert.equal(agente.historial.length, 6);
});

test('respeta el máximo de pasos', async () => {
  const modelo = new MockLanguageModelV4({
    doGenerate: () => Promise.resolve(llamada('x', 'calcular_costos', {})),
  });
  const agente = crearAgente({ modelo, maxPasos: 3 });
  const r = await agente.preguntar('loop infinito');
  assert.equal(r.pasos.length, 3);
  assert.equal(r.agotoPasos, true);
  assert.match(r.respuesta, /No llegué a una respuesta final/);
});

test('simular_escenario no modifica; actualizar_parametros sí', async () => {
  const modelo = new MockLanguageModelV4({
    doGenerate: [
      llamada('1', 'simular_escenario', { cambios: { precioGasoil: 2000 } }),
      llamada('2', 'calcular_costos', {}),
      llamada('3', 'actualizar_parametros', { cambios: { precioGasoil: 2000 } }),
      llamada('4', 'calcular_costos', {}),
      texto('listo'),
    ],
  });
  const agente = crearAgente({ modelo });
  const { pasos } = await agente.preguntar('gasoil a 2000');
  const base = calcular(PARAMETROS_POR_DEFECTO).totalCostos;
  const sim = pasos[0].toolResults[0].output as any;
  assert.equal(sim.diferencia.totalCostos, 3095 * (2000 - 1366));
  assert.equal((pasos[1].toolResults[0].output as any).totalCostos, base);
  assert.equal((pasos[3].toolResults[0].output as any).totalCostos, base + 3095 * (2000 - 1366));
});

test('calculadora rechaza código arbitrario', async () => {
  const modelo = new MockLanguageModelV4({
    doGenerate: [llamada('1', 'calculadora', { expresion: 'process.exit(1)' }), texto('ok')],
  });
  const { pasos } = await crearAgente({ modelo }).preguntar('x');
  assert.ok('error' in (pasos[0].toolResults[0].output as object));
});
