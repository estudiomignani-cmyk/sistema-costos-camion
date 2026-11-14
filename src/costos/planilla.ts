/**
 * Conversión entre el estado que guarda la planilla web (index.html → estadoActual())
 * y los Parametros del modelo de costos que usa el agente.
 */
import { z } from 'zod';
import { PARAMETROS_POR_DEFECTO, type Parametros } from './modelo';

const num = z.coerce.number().refine(Number.isFinite);
const texto = z.string().max(120);

export const estadoPlanillaSchema = z.object({
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  fijos: z.array(z.object({ c: texto, i: num })).max(100),
  vars: z.array(z.object({ c: texto, i: num, key: z.string() })).max(100),
  aceites: z.array(z.object({ c: texto, cap: num, pr: num, vu: num })).max(50),
  filtros: z.array(z.object({ c: texto, cant: num, pr: num, vu: num })).max(50),
});
export type EstadoPlanilla = z.infer<typeof estadoPlanillaSchema>;

/** Campos escalares de Parametros ↔ id del input en la planilla. */
export const ID_INPUT = {
  kmMes: 'p-km',
  viajesMes: 'p-viajes',
  toneladasPorViaje: 'p-tn',
  tarifaPorTn: 'p-tarifa',
  precioGasoil: 'pr-gasoil',
  consumoLts100km: 'cons-gasoil',
  repuestosMes: 'p-repuestos',
  precioCubiertaDelantera: 'pr-del',
  precioCubiertaTraccion: 'pr-trac',
  precioCubiertaAcoplado: 'pr-acop',
} as const;

export function parametrosDesdePlanilla(e: EstadoPlanilla): Parametros {
  const d = PARAMETROS_POR_DEFECTO;
  const p = (id: string, def: number) => {
    const v = Number(e.params[id]);
    return e.params[id] === '' || !Number.isFinite(v) ? def : v;
  };
  return {
    ...d,
    kmMes: p('p-km', 0),
    viajesMes: p('p-viajes', 0),
    toneladasPorViaje: p('p-tn', 0),
    tarifaPorTn: p('p-tarifa', 0),
    precioGasoil: p('pr-gasoil', 0),
    consumoLts100km: p('cons-gasoil', 0),
    repuestosMes: p('p-repuestos', 0),
    cubiertas: {
      delanteras: { cantidad: p('q-del', 0), precio: p('pr-del', 0), vidaUtilKm: p('vu-del', 0) },
      traccion: { cantidad: p('q-trac', 0), precio: p('pr-trac', 0), vidaUtilKm: p('vu-trac', 0) },
      acoplado: { cantidad: p('q-acop', 0), precio: p('pr-acop', 0), vidaUtilKm: p('vu-acop', 0) },
    },
    fijos: e.fijos.map(f => ({ concepto: f.c, importe: f.i })),
    otrosVariables: e.vars.filter(v => v.key.startsWith('manual_')).map(v => ({ concepto: v.c, importe: v.i })),
    aceites: e.aceites.map(a => ({ concepto: a.c, capacidadLts: a.cap, precioLt: a.pr, vidaUtilKm: a.vu })),
    filtros: e.filtros.map(f => ({ concepto: f.c, cantidad: f.cant, precio: f.pr, vidaUtilKm: f.vu })),
  };
}
