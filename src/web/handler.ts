/**
 * Endpoint HTTP del agente para la planilla web (Netlify Function y servidor local).
 *
 * POST /api/agente  { mensajes: [{rol, texto}], estado: <estado de la planilla> }
 * Responde en streaming NDJSON (una línea JSON por evento) para mostrar el ciclo
 * ReAct en vivo:
 *   {"tipo":"paso", numero, razonamiento?, pensamiento?, acciones:[{tool, input, output}]}
 *   {"tipo":"cambios", cambios}   ← el agente modificó parámetros; la planilla los aplica
 *   {"tipo":"final", respuesta, pasos}
 *   {"tipo":"error", mensaje}
 */
import { z } from 'zod';
import type { LanguageModel, ModelMessage } from 'ai';
import { crearAgente } from '../agente/agente';
import type { Cambios } from '../agente/tools';
import { estadoPlanillaSchema, parametrosDesdePlanilla } from '../costos/planilla';

const MAX_MENSAJES = 20;
const MAX_PASOS_WEB = 8;

const cuerpoSchema = z.object({
  mensajes: z.array(z.object({
    rol: z.enum(['usuario', 'asistente']),
    texto: z.string().min(1).max(2000),
  })).min(1).max(MAX_MENSAJES * 2),
  estado: estadoPlanillaSchema,
});

export interface OpcionesHandler {
  /** Fábrica del modelo; por defecto Gemini (ver crearAgente). Se inyecta en tests. */
  modelo?: () => LanguageModel;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function crearHandler(opciones: OpcionesHandler = {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'Usar POST' });
    if (!opciones.modelo && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return json(500, { error: 'El servidor no tiene configurada GOOGLE_GENERATIVE_AI_API_KEY.' });
    }

    let cuerpo: z.infer<typeof cuerpoSchema>;
    try {
      cuerpo = cuerpoSchema.parse(await req.json());
    } catch {
      return json(400, { error: 'Pedido inválido' });
    }

    const mensajes = cuerpo.mensajes.slice(-MAX_MENSAJES);
    const ultimo = mensajes.pop()!;
    if (ultimo.rol !== 'usuario') return json(400, { error: 'El último mensaje debe ser del usuario' });
    const historial: ModelMessage[] = mensajes.map(m =>
      m.rol === 'usuario' ? { role: 'user', content: m.texto } : { role: 'assistant', content: m.texto });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enviar = (evento: object) => controller.enqueue(encoder.encode(JSON.stringify(evento) + '\n'));
        const cambios: Cambios[] = [];
        try {
          const agente = crearAgente({
            modelo: opciones.modelo?.(),
            maxPasos: MAX_PASOS_WEB,
            escenario: parametrosDesdePlanilla(cuerpo.estado),
            historial,
            onActualizar: c => cambios.push(c),
            onPaso: (paso, numero) => enviar({
              tipo: 'paso',
              numero,
              razonamiento: paso.reasoningText?.trim() || undefined,
              pensamiento: paso.toolCalls.length > 0 ? paso.text.trim() || undefined : undefined,
              acciones: paso.toolCalls.map(llamada => {
                const resultado = paso.toolResults.find(r => r.toolCallId === llamada.toolCallId);
                const error = paso.content.find(c => c.type === 'tool-error' && c.toolCallId === llamada.toolCallId);
                return {
                  tool: llamada.toolName,
                  input: llamada.input,
                  output: resultado?.output ?? (error ? { error: String((error as { error: unknown }).error) } : null),
                };
              }),
            }),
          });
          const { respuesta, pasos } = await agente.preguntar(ultimo.texto);
          if (cambios.length) enviar({ tipo: 'cambios', cambios });
          enviar({ tipo: 'final', respuesta, pasos: pasos.length });
        } catch (e) {
          console.error('Error del agente:', e);
          enviar({ tipo: 'error', mensaje: 'El agente no pudo responder. Probá de nuevo en un momento.' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  };
}
