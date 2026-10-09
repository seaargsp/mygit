import * as net from 'node:net';
import { IDLE_TIMEOUT_MS, MAX_REQUEST_BYTES, type AskpassRequest, type AskpassResponse } from './askpassProtocol';

/** Sends one prompt to the extension and resolves to the answer, or null when refused, dismissed or failed. */
export function requestCredential(handle: string, request: AskpassRequest, timeoutMs = IDLE_TIMEOUT_MS): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    let buffer = '';
    const socket = net.createConnection(handle);
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(null));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\n');
      if (end === -1) {
        if (buffer.length > MAX_REQUEST_BYTES * 8) done(null);
        return;
      }
      try {
        const response = JSON.parse(buffer.slice(0, end)) as AskpassResponse;
        done(response.ok ? response.value : null);
      } catch {
        done(null);
      }
    });
    socket.on('error', () => done(null));
    socket.on('close', () => done(null));
  });
}
