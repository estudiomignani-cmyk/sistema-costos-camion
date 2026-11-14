/**
 * Agente ReAct (Reasoning + Acting) sobre el AI SDK de Vercel + Gemini.
 *
 * Ciclo por cada "paso" (step) de generateText:
 *   1. Razonamiento  → el modelo piensa qué necesita (thoughts de Gemini / texto previo).
 *   2. Acción        → emite una o más llamadas a tools.
 *   3. Observación   → el SDK ejecuta la tool y devuelve el resultado al modelo.
 *   4. Repite hasta que el modelo responde SIN llamar tools (respuesta final)
 *      o se alcanza el máximo de pasos (`stopWhen: stepCountIs(n)`).
 */
import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type StepResult } from 'ai';
import { google } from '@ai-sdk/google';
import { crearTools, type Cambios, type ToolsAgente } from './tools';
import type { Parametros } from '../costos/modelo';

export const MODELO_POR_DEFECTO = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
export const MAX_PASOS_POR_DEFECTO = 10;

export const INSTRUCCIONES = `Sos un analista de costos de transporte de cargas que asiste al dueño de un camión Fiat Cursor 330 con acoplado (Argentina, montos en pesos).

Trabajás con la metodología ReAct:
- Pensamiento: antes de actuar, razoná brevemente qué dato necesitás y qué herramienta te lo da.
- Acción: llamá a la herramienta adecuada. Nunca inventes números: todo valor debe salir de una herramienta.
- Observación: leé el resultado y decidí si alcanza para responder o si necesitás otra acción.
- Repetí hasta tener la información suficiente; recién entonces da la respuesta final.

Reglas:
- Para cualquier cuenta usá "calculadora"; no hagas aritmética mental.
- Para preguntas hipotéticas ("¿qué pasa si...?") usá "simular_escenario", que no modifica nada.
- Usá "actualizar_parametros" solo si el usuario pide explícitamente cambiar un valor.
- Si una herramienta devuelve error, corregí la entrada y reintentá.
- Respuesta final: en español rioplatense, concisa, con montos formateados ($ 1.234.567) e indicando de dónde sale cada cifra.`;

export type PasoReAct = StepResult<ToolsAgente>;

export interface OpcionesAgente {
  /** Modelo a usar. Por defecto Gemini vía @ai-sdk/google (lee GOOGLE_GENERATIVE_AI_API_KEY). */
  modelo?: LanguageModel;
  maxPasos?: number;
  escenario?: Parametros;
  /** Mensajes previos de la conversación (memoria). */
  historial?: ModelMessage[];
  /** Se invoca al terminar cada paso del ciclo (útil para mostrar la traza ReAct). */
  onPaso?: (paso: PasoReAct, numero: number) => void | Promise<void>;
  /** Se invoca cuando el agente aplica cambios permanentes al escenario. */
  onActualizar?: (cambios: Cambios) => void;
}

export function crearAgente(opciones: OpcionesAgente = {}) {
  const modelo = opciones.modelo ?? google(MODELO_POR_DEFECTO);
  const maxPasos = opciones.maxPasos ?? MAX_PASOS_POR_DEFECTO;
  const tools = crearTools(opciones.escenario, { onActualizar: opciones.onActualizar });
  const historial: ModelMessage[] = [...(opciones.historial ?? [])];

  async function preguntar(pregunta: string) {
    historial.push({ role: 'user', content: pregunta });
    let numero = 0;

    const resultado = await generateText({
      model: modelo,
      system: INSTRUCCIONES,
      messages: historial,
      tools,
      // Condición de corte del loop ReAct: el SDK sigue iterando mientras el modelo
      // pida tools; se detiene al recibir texto final o al llegar a `maxPasos`.
      stopWhen: stepCountIs(maxPasos),
      providerOptions: {
        // Expone los "thoughts" de Gemini como reasoning → la fase de Razonamiento visible.
        google: { thinkingConfig: { includeThoughts: true } },
      },
      onStepEnd: async paso => {
        numero += 1;
        await opciones.onPaso?.(paso, numero);
      },
    });

    // Memoria conversacional: se agregan los mensajes del asistente y de tools.
    historial.push(...resultado.responseMessages);

    const ultimo = resultado.steps.at(-1);
    const agotoPasos = resultado.steps.length >= maxPasos && (ultimo?.toolCalls.length ?? 0) > 0;

    return {
      respuesta: agotoPasos && !resultado.text
        ? `No llegué a una respuesta final en ${maxPasos} pasos. Probá reformular la pregunta o subir el máximo de pasos.`
        : resultado.text,
      pasos: resultado.steps,
      agotoPasos,
      uso: resultado.totalUsage,
    };
  }

  return { preguntar, historial, tools };
}
