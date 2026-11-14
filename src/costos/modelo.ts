/**
 * Modelo de costos del camión (Fiat Cursor 330).
 * Réplica en TypeScript puro de la lógica de cálculo de `index.html`,
 * para que el agente pueda usarla como herramienta sin depender del DOM.
 */

export interface ItemFijo { concepto: string; importe: number }
export interface Cubierta { cantidad: number; precio: number; vidaUtilKm: number }
export interface Aceite { concepto: string; capacidadLts: number; precioLt: number; vidaUtilKm: number }
export interface Filtro { concepto: string; cantidad: number; precio: number; vidaUtilKm: number }

export interface Parametros {
  kmMes: number;
  viajesMes: number;
  toneladasPorViaje: number;
  tarifaPorTn: number;
  porcentajeSueldoChofer: number;
  precioGasoil: number;
  consumoLts100km: number;
  repuestosMes: number;
  cubiertas: { delanteras: Cubierta; traccion: Cubierta; acoplado: Cubierta };
  fijos: ItemFijo[];
  aceites: Aceite[];
  filtros: Filtro[];
}

export const PARAMETROS_POR_DEFECTO: Parametros = {
  kmMes: 10080,
  viajesMes: 12,
  toneladasPorViaje: 30,
  tarifaPorTn: 1283,
  porcentajeSueldoChofer: 0.18,
  precioGasoil: 1366,
  consumoLts100km: 30.7,
  repuestosMes: 100000,
  cubiertas: {
    delanteras: { cantidad: 2, precio: 580438, vidaUtilKm: 120000 },
    traccion: { cantidad: 4, precio: 530000, vidaUtilKm: 120000 },
    acoplado: { cantidad: 12, precio: 506368, vidaUtilKm: 100000 },
  },
  fijos: [
    { concepto: 'Patente chasis', importe: 30000 },
    { concepto: 'Patente acoplado', importe: 25000 },
    { concepto: 'Seguro automotor chasis', importe: 200000 },
    { concepto: 'Seguro de carga chasis', importe: 80000 },
    { concepto: 'Seguro automotor acoplado', importe: 120000 },
    { concepto: 'Seguro de carga acoplado', importe: 75000 },
    { concepto: 'Seguro accidentes personales chofer', importe: 45000 },
    { concepto: 'Cargas sociales', importe: 500000 },
  ],
  aceites: [
    { concepto: 'Aceite motor', capacidadLts: 30, precioLt: 8400, vidaUtilKm: 30000 },
    { concepto: 'Aceite de caja', capacidadLts: 8.8, precioLt: 34695, vidaUtilKm: 80000 },
    { concepto: 'Aceite de diferencial', capacidadLts: 17, precioLt: 96146, vidaUtilKm: 80000 },
  ],
  filtros: [
    { concepto: 'Filtro de aceite', cantidad: 1, precio: 15000, vidaUtilKm: 15000 },
    { concepto: 'Filtro de gasoil', cantidad: 1, precio: 12000, vidaUtilKm: 15000 },
    { concepto: 'Filtro trampa gasoil', cantidad: 1, precio: 18000, vidaUtilKm: 20000 },
    { concepto: 'Filtro de aire', cantidad: 1, precio: 22000, vidaUtilKm: 30000 },
    { concepto: 'Filtro de aire interno', cantidad: 1, precio: 18000, vidaUtilKm: 30000 },
    { concepto: 'Filtro de secado', cantidad: 1, precio: 14000, vidaUtilKm: 60000 },
  ],
};

export type Categoria = 'fijo' | 'cubiertas' | 'gasoil' | 'sueldo' | 'repuestos' | 'aceites' | 'filtros';
export interface ItemCosto { concepto: string; categoria: Categoria; tipo: 'fijo' | 'variable'; importe: number }

export interface Resultado {
  items: ItemCosto[];
  litrosGasoil: number;
  toneladasMes: number;
  totalFijos: number;
  totalVariables: number;
  totalCostos: number;
  costoPorKm: number | null;
  costoPorTn: number | null;
  ingresos: number;
  resultadoMensual: number;
  resultadoAnual: number;
  margenSobreIngresos: number | null;
  resultadoPorViaje: number | null;
}

const prorrateo = (cant: number, precio: number, vida: number, km: number) =>
  km > 0 && vida > 0 ? Math.round((cant * precio) / vida * km) : 0;

export function calcular(p: Parametros): Resultado {
  const km = p.kmMes;
  const toneladasMes = p.viajesMes * p.toneladasPorViaje;
  const litrosGasoil = Math.round((km * p.consumoLts100km) / 100);
  const { delanteras: d, traccion: t, acoplado: a } = p.cubiertas;

  const items: ItemCosto[] = [
    ...p.fijos.map((f): ItemCosto => ({ concepto: f.concepto, categoria: 'fijo', tipo: 'fijo', importe: f.importe })),
    { concepto: 'Cubiertas delanteras chasis', categoria: 'cubiertas', tipo: 'variable', importe: prorrateo(d.cantidad, d.precio, d.vidaUtilKm, km) },
    { concepto: 'Cubiertas tracción chasis', categoria: 'cubiertas', tipo: 'variable', importe: prorrateo(t.cantidad, t.precio, t.vidaUtilKm, km) },
    { concepto: 'Cubiertas acoplado', categoria: 'cubiertas', tipo: 'variable', importe: prorrateo(a.cantidad, a.precio, a.vidaUtilKm, km) },
    { concepto: 'Gasoil', categoria: 'gasoil', tipo: 'variable', importe: Math.round(litrosGasoil * p.precioGasoil) },
    { concepto: 'Sueldo chofer', categoria: 'sueldo', tipo: 'variable', importe: Math.round(toneladasMes * p.tarifaPorTn * p.porcentajeSueldoChofer) },
    { concepto: 'Repuestos y reparaciones', categoria: 'repuestos', tipo: 'variable', importe: p.repuestosMes },
    ...p.aceites.map((x): ItemCosto => ({ concepto: x.concepto, categoria: 'aceites', tipo: 'variable', importe: prorrateo(x.capacidadLts, x.precioLt, x.vidaUtilKm, km) })),
    ...p.filtros.map((x): ItemCosto => ({ concepto: x.concepto, categoria: 'filtros', tipo: 'variable', importe: prorrateo(x.cantidad, x.precio, x.vidaUtilKm, km) })),
  ];

  const totalFijos = items.filter(i => i.tipo === 'fijo').reduce((s, i) => s + i.importe, 0);
  const totalVariables = items.filter(i => i.tipo === 'variable').reduce((s, i) => s + i.importe, 0);
  const totalCostos = totalFijos + totalVariables;
  const ingresos = toneladasMes * p.tarifaPorTn;
  const resultadoMensual = ingresos - totalCostos;

  return {
    items,
    litrosGasoil,
    toneladasMes,
    totalFijos,
    totalVariables,
    totalCostos,
    costoPorKm: km > 0 ? totalCostos / km : null,
    costoPorTn: toneladasMes > 0 ? totalCostos / toneladasMes : null,
    ingresos,
    resultadoMensual,
    resultadoAnual: resultadoMensual * 12,
    margenSobreIngresos: ingresos > 0 ? resultadoMensual / ingresos : null,
    resultadoPorViaje: p.viajesMes > 0 ? resultadoMensual / p.viajesMes : null,
  };
}

/** Tarifa ($/tn) a partir de la cual el resultado mensual es >= 0 (el sueldo depende de la tarifa). */
export function tarifaDeEquilibrio(p: Parametros): number | null {
  const tn = p.viajesMes * p.toneladasPorViaje;
  const factor = tn * (1 - p.porcentajeSueldoChofer);
  if (factor <= 0) return null;
  const costosSinSueldo = calcular({ ...p, tarifaPorTn: 0 }).totalCostos;
  return costosSinSueldo / factor;
}

export const clonar = (p: Parametros): Parametros => structuredClone(p);
