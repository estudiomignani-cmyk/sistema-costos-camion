# Agente ReAct de costos (AI SDK + Gemini)

Agente que responde preguntas sobre los costos del camión razonando, llamando
herramientas, observando sus resultados y repitiendo hasta dar una respuesta final.

## Uso

```bash
npm install
cp .env.example .env   # completar GOOGLE_GENERATIVE_AI_API_KEY
npm run agente                                   # chat interactivo
npm run agente -- "¿Qué pasa si el gasoil sube a $1800?"   # una sola pregunta
npm run agente -- --sin-traza "..."              # sin mostrar los pasos
npm test                                         # tests con modelo simulado (sin API key)
```

## Cómo funciona el ciclo ReAct

`src/agente/agente.ts` usa `generateText` con `tools` y `stopWhen: stepCountIs(10)`.
En cada paso:

1. **Razonamiento** – Gemini piensa (`thinkingConfig.includeThoughts`), visible como 🧠.
2. **Acción** – el modelo pide una tool (🔧).
3. **Observación** – el SDK ejecuta la tool y devuelve el resultado al modelo (👁).
4. Se repite hasta que el modelo responde sin pedir tools (✅) o se llega al máximo de pasos.

El historial se guarda entre preguntas (memoria conversacional) y cada sesión
tiene su propio escenario de parámetros.

## Herramientas (`src/agente/tools.ts`)

| Tool | Qué hace |
|---|---|
| `obtener_parametros` | Parámetros actuales del escenario |
| `calcular_costos` | Totales, $/km, $/tn, ingresos, resultado, margen |
| `desglose_costos` | Ítems ordenados por importe, filtrables |
| `simular_escenario` | "Qué pasa si…" sin modificar el escenario |
| `actualizar_parametros` | Cambia el escenario de la sesión |
| `punto_de_equilibrio` | Tarifa y toneladas mínimas para no perder |
| `calculadora` | Aritmética segura (el modelo no hace cuentas de cabeza) |

El modelo de costos (`src/costos/modelo.ts`) replica las fórmulas de `index.html`.

## Chat en la planilla web

El botón **💬 Asistente** de `index.html` abre un panel de chat que conversa con el
mismo agente, usando los datos cargados en la planilla en ese momento.

- **Servidor**: `src/web/handler.ts`, publicado como Netlify Function en `/api/agente`
  (`netlify/functions/agente.mts`). Responde en streaming (NDJSON), así el panel muestra
  cada paso del ciclo ReAct a medida que ocurre.
- **Clave**: se configura en Netlify → *Project configuration* → *Environment variables*
  como `GOOGLE_GENERATIVE_AI_API_KEY`. Nunca llega al navegador.
- **Cambios**: si le pedís al agente que cambie un valor, el cambio se aplica a la
  planilla y queda guardado.
- **Local**: `npm run dev` levanta la planilla y el endpoint en http://localhost:8888.

El endpoint es público: cualquiera con el link puede usar el chat y consumir la cuota
de Gemini. Cada pedido está limitado (20 mensajes, 2000 caracteres, 8 pasos).
