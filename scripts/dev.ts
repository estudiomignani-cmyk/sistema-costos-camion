/**
 * Servidor local: sirve index.html y el endpoint /api/agente (como en Netlify).
 *   npm run dev   → http://localhost:8888
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { crearHandler } from '../src/web/handler';

const handler = crearHandler();
const PUERTO = Number(process.env.PORT ?? 8888);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/api/agente') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const respuesta = await handler(new Request(url, {
        method: req.method, headers: req.headers as Record<string, string>,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      }));
      res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
      if (respuesta.body) Readable.fromWeb(respuesta.body as never).pipe(res); else res.end();
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(new URL('../index.html', import.meta.url)));
      return;
    }
    res.writeHead(404).end('No encontrado');
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error');
  }
}).listen(PUERTO, () => console.log(`Planilla + agente en http://localhost:${PUERTO}`));
