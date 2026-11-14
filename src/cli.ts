/**
 * CLI interactiva del agente ReAct.
 *   npm run agente                     → modo chat
 *   npm run agente -- "¿Cuál es mi costo por km?"  → una sola pregunta
 */
import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { crearAgente, MODELO_POR_DEFECTO } from './agente/agente';
import { imprimirPaso } from './agente/traza';

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error('Falta GOOGLE_GENERATIVE_AI_API_KEY (copiá .env.example a .env y completala).');
    process.exit(1);
  }
  const verTraza = !process.argv.includes('--sin-traza');
  const agente = crearAgente({ onPaso: verTraza ? imprimirPaso : undefined });
  const preguntaUnica = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();

  const responder = async (pregunta: string) => {
    try {
      const { respuesta, pasos } = await agente.preguntar(pregunta);
      console.log(`\n🤖 ${respuesta}\n\x1b[90m(${pasos.length} pasos)\x1b[0m\n`);
    } catch (e) {
      console.error(`\n❌ Error: ${(e as Error).message}\n`);
    }
  };

  if (preguntaUnica) return responder(preguntaUnica);

  console.log(`Agente de costos (ReAct · ${MODELO_POR_DEFECTO}). Escribí "salir" para terminar.\n`);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  for (;;) {
    const pregunta = (await rl.question('👤 ')).trim();
    if (!pregunta) continue;
    if (['salir', 'exit', 'quit'].includes(pregunta.toLowerCase())) break;
    await responder(pregunta);
  }
  rl.close();
}

main();
