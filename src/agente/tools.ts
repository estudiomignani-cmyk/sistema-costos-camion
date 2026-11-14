/**
 * Herramientas (Actions) que el agente ReAct puede invocar.
 * Cada tool recibe input validado con zod y devuelve una Observación serializable.
 */
import { tool } from 'ai';
import { z } from 'zod';
import {
  calcular, clonar, tarifaDeEquilibrio, PARAMETROS_POR_DEFECTO,
  type Parametros, type Resultado,
} from '../costos/modelo';

const redondear = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

function resumen(r: Resultado) {
  return {
    totalFijos: r.totalFijos,
    totalVariables: r.totalVariables,
    totalCostos: r.totalCostos,
    costoPorKm: redondear(r.costoPorKm),
    costoPorTn: redondear(r.costoPorTn),
    toneladasMes: r.toneladasMes,
    litrosGasoil: r.litrosGasoil,
    ingresos: r.ingresos,
    resultadoMensual: r.resultadoMensual,
    resultadoAnual: r.resultadoAnual,
    margenSobreIngresosPct: redondear(r.margenSobreIngresos === null ? null : r.margenSobreIngresos * 100),
    resultadoPorViaje: redondear(r.resultadoPorViaje, 0),
  };
}

/** Cambios escalares que se pueden simular o aplicar sobre el escenario. */
const cambiosSchema = z.object({
  kmMes: z.number().positive().optional(),
  viajesMes: z.number().positive().optional(),
  toneladasPorViaje: z.number().positive().optional(),
  tarifaPorTn: z.number().nonnegative().optional(),
  porcentajeSueldoChofer: z.number().min(0).max(1).optional().describe('Fracción, ej. 0.18 = 18%'),
  precioGasoil: z.number().nonnegative().optional(),
  consumoLts100km: z.number().nonnegative().optional(),
  repuestosMes: z.number().nonnegative().optional(),
  precioCubiertaDelantera: z.number().nonnegative().optional(),
  precioCubiertaTraccion: z.number().nonnegative().optional(),
  precioCubiertaAcoplado: z.number().nonnegative().optional(),
  costoFijo: z.array(z.object({ concepto: z.string(), importe: z.number().nonnegative() })).optional()
    .describe('Modifica (o agrega si no existe) costos fijos mensuales por concepto'),
}).describe('Solo incluir los parámetros que cambian');

type Cambios = z.infer<typeof cambiosSchema>;

function aplicarCambios(base: Parametros, c: Cambios): Parametros {
  const p = clonar(base);
  const escalares = ['kmMes', 'viajesMes', 'toneladasPorViaje', 'tarifaPorTn', 'porcentajeSueldoChofer',
    'precioGasoil', 'consumoLts100km', 'repuestosMes'] as const;
  for (const k of escalares) if (c[k] !== undefined) p[k] = c[k]!;
  if (c.precioCubiertaDelantera !== undefined) p.cubiertas.delanteras.precio = c.precioCubiertaDelantera;
  if (c.precioCubiertaTraccion !== undefined) p.cubiertas.traccion.precio = c.precioCubiertaTraccion;
  if (c.precioCubiertaAcoplado !== undefined) p.cubiertas.acoplado.precio = c.precioCubiertaAcoplado;
  for (const f of c.costoFijo ?? []) {
    const existente = p.fijos.find(x => x.concepto.toLowerCase() === f.concepto.toLowerCase());
    if (existente) existente.importe = f.importe; else p.fijos.push({ ...f });
  }
  return p;
}

/**
 * Crea el set de tools sobre un escenario mutable (estado de la sesión).
 * Se crea por sesión para que cada conversación tenga su propio escenario.
 */
export function crearTools(escenarioInicial: Parametros = PARAMETROS_POR_DEFECTO) {
  let escenario = clonar(escenarioInicial);

  return {
    obtener_parametros: tool({
      description: 'Devuelve los parámetros actuales del escenario (km, viajes, tarifa, precios de gasoil, cubiertas, aceites, filtros y costos fijos).',
      inputSchema: z.object({}),
      execute: async () => escenario,
    }),

    calcular_costos: tool({
      description: 'Calcula costos totales, costo por km y por tonelada, ingresos, resultado mensual/anual y margen del escenario actual.',
      inputSchema: z.object({}),
      execute: async () => resumen(calcular(escenario)),
    }),

    desglose_costos: tool({
      description: 'Lista los ítems de costo mensual ordenados de mayor a menor, con su porcentaje sobre el total. Permite filtrar por tipo o categoría.',
      inputSchema: z.object({
        tipo: z.enum(['fijo', 'variable']).optional(),
        categoria: z.enum(['fijo', 'cubiertas', 'gasoil', 'sueldo', 'repuestos', 'aceites', 'filtros']).optional(),
        top: z.number().int().positive().optional().describe('Cantidad máxima de ítems a devolver'),
      }),
      execute: async ({ tipo, categoria, top }) => {
        const r = calcular(escenario);
        const items = r.items
          .filter(i => (!tipo || i.tipo === tipo) && (!categoria || i.categoria === categoria))
          .sort((a, b) => b.importe - a.importe)
          .slice(0, top ?? Infinity)
          .map(i => ({ ...i, pctDelTotal: redondear((i.importe / r.totalCostos) * 100) }));
        return { totalCostos: r.totalCostos, items };
      },
    }),

    simular_escenario: tool({
      description: 'Simula un escenario "qué pasa si" SIN modificar el escenario actual. Devuelve el resultado actual, el simulado y la diferencia.',
      inputSchema: z.object({ cambios: cambiosSchema }),
      execute: async ({ cambios }) => {
        const actual = resumen(calcular(escenario));
        const simulado = resumen(calcular(aplicarCambios(escenario, cambios)));
        const diferencia = Object.fromEntries(
          Object.entries(simulado).map(([k, v]) => {
            const a = actual[k as keyof typeof actual];
            return [k, typeof v === 'number' && typeof a === 'number' ? redondear(v - a) : null];
          }),
        );
        return { actual, simulado, diferencia };
      },
    }),

    actualizar_parametros: tool({
      description: 'Aplica cambios de forma PERMANENTE al escenario de la sesión. Usar solo cuando el usuario pida explícitamente cambiar/fijar un valor.',
      inputSchema: z.object({ cambios: cambiosSchema }),
      execute: async ({ cambios }) => {
        escenario = aplicarCambios(escenario, cambios);
        return { ok: true, aplicado: cambios, nuevoResumen: resumen(calcular(escenario)) };
      },
    }),

    punto_de_equilibrio: tool({
      description: 'Calcula la tarifa mínima ($/tn) para no tener pérdida, y cuántas toneladas/mes harían falta con la tarifa actual.',
      inputSchema: z.object({}),
      execute: async () => {
        const tarifa = tarifaDeEquilibrio(escenario);
        const r = calcular(escenario);
        const costosNoSueldo = r.totalCostos - (r.items.find(i => i.categoria === 'sueldo')?.importe ?? 0);
        const margenPorTn = escenario.tarifaPorTn * (1 - escenario.porcentajeSueldoChofer);
        return {
          tarifaEquilibrioPorTn: redondear(tarifa),
          tarifaActualPorTn: escenario.tarifaPorTn,
          toneladasMesEquilibrio: margenPorTn > 0 ? redondear(costosNoSueldo / margenPorTn) : null,
          toneladasMesActuales: r.toneladasMes,
          nota: 'Toneladas de equilibrio asumen costos por km constantes (mismos km/mes).',
        };
      },
    }),

    calculadora: tool({
      description: 'Evalúa una expresión aritmética (+ - * / % paréntesis y decimales). Usar para cualquier cuenta, en lugar de calcular mentalmente.',
      inputSchema: z.object({ expresion: z.string().describe('Ej: "(1283*360) - 9500000"') }),
      execute: async ({ expresion }) => {
        if (!/^[\d\s+\-*/%().,]+$/.test(expresion)) return { error: 'Expresión inválida: solo números y operadores + - * / % ( )' };
        try {
          const valor = Function(`"use strict"; return (${expresion.replace(/,/g, '.')});`)();
          if (typeof valor !== 'number' || !Number.isFinite(valor)) return { error: 'Resultado no numérico' };
          return { expresion, resultado: valor };
        } catch (e) {
          return { error: `No se pudo evaluar: ${(e as Error).message}` };
        }
      },
    }),
  };
}

export type ToolsAgente = ReturnType<typeof crearTools>;
