/** Formatea cada paso del ciclo ReAct para mostrarlo en consola. */
import type { PasoReAct } from './agente';

const gris = (s: string) => `\x1b[90m${s}\x1b[0m`;
const recortar = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + '…' : s);

export function imprimirPaso(paso: PasoReAct, numero: number) {
  console.log(gris(`\n── Paso ${numero} ─────────────────────────────`));
  if (paso.reasoningText?.trim()) console.log(`🧠 Razonamiento: ${gris(recortar(paso.reasoningText.trim()))}`);
  if (paso.toolCalls.length > 0 && paso.text.trim()) console.log(`🧠 Pensamiento: ${paso.text.trim()}`);
  for (const llamada of paso.toolCalls) {
    console.log(`🔧 Acción: ${llamada.toolName}(${JSON.stringify(llamada.input)})`);
  }
  for (const r of paso.toolResults) {
    console.log(`👁  Observación [${r.toolName}]: ${gris(recortar(JSON.stringify(r.output)))}`);
  }
  for (const parte of paso.content) {
    if (parte.type === 'tool-error') console.log(`⚠️  Error en ${parte.toolName}: ${String(parte.error)}`);
  }
  if (paso.toolCalls.length === 0) console.log('✅ Respuesta final generada');
}
