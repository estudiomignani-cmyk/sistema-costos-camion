import type { Config } from '@netlify/functions';
import { crearHandler } from '../../src/web/handler';

export default crearHandler();

export const config: Config = { path: '/api/agente' };
