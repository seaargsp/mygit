import { afterEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AskpassServer } from '../src/ipc/askpassServer';
import { requestCredential } from '../src/ipc/askpassClient';

let server: AskpassServer | undefined;
afterEach(() => {
  server?.dispose();
  server = undefined;
});

describe.skipIf(process.platform === 'win32')('AskpassServer', () => {
  it('answers a request carrying the session token', async () => {
    const prompter = vi.fn(async (prompt: string) => (prompt.includes('Username') ? 'me' : 'secret'));
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter });
    const token = server.tokenForTests();
    expect(await requestCredential(server.handle, { token, id: 'a', prompt: "Password for 'https://h': " })).toBe('secret');
    expect(prompter).toHaveBeenCalledWith("Password for 'https://h': ");
  });

  it('rejects a wrong or truncated token without prompting', async () => {
    const prompter = vi.fn(async () => 'secret');
    const onReject = vi.fn();
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter, onReject });
    const token = server.tokenForTests();
    expect(await requestCredential(server.handle, { token: 'x'.repeat(64), id: 'a', prompt: 'p' })).toBeNull();
    expect(await requestCredential(server.handle, { token: token.slice(1), id: 'a', prompt: 'p' })).toBeNull();
    expect(prompter).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('askpass: rejected connection');
  });

  it('closes an oversize request', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => 'x' });
    const closed = await new Promise<boolean>(resolve => {
      const socket = net.createConnection(server!.handle, () => socket.write('a'.repeat(9000)));
      socket.on('close', () => resolve(true));
      socket.on('error', () => resolve(true));
    });
    expect(closed).toBe(true);
  });

  it('returns null when the prompt is dismissed', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => undefined });
    expect(await requestCredential(server.handle, { token: server.tokenForTests(), id: 'a', prompt: 'p' })).toBeNull();
  });

  it('pauses the timer of the invocation that asked', async () => {
    server = await AskpassServer.start({ extensionPath: os.tmpdir(), prompter: async () => 'v' });
    const timer = { pause: vi.fn(), resume: vi.fn() };
    const unregister = server.register('inv-1', timer);
    await requestCredential(server.handle, { token: server.tokenForTests(), id: 'inv-1', prompt: 'p' });
    expect(timer.pause).toHaveBeenCalledTimes(1);
    expect(timer.resume).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('exposes env without the token on argv', () => {
    return AskpassServer.start({ extensionPath: '/ext', prompter: async () => 'v' }).then(started => {
      server = started;
      const env = started.env('inv-2');
      expect(env.GIT_ASKPASS).toBe('/ext/media/askpass.sh');
      expect(env.SSH_ASKPASS_REQUIRE).toBe('force');
      expect(env.MYGIT_ASKPASS_TOKEN).toBe(started.tokenForTests());
      expect(env.MYGIT_ASKPASS_ID).toBe('inv-2');
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });
  });
});

describe.skipIf(process.platform === 'win32')('askpass shim', () => {
  it('prints the answer when git runs media/askpass.sh', async () => {
    const root = path.join(__dirname, '..');
    if (!fs.existsSync(path.join(root, 'dist', 'askpass-main.js'))) return;
    server = await AskpassServer.start({ extensionPath: root, prompter: async prompt => `answer for ${prompt}` });
    const env = { ...process.env, ...server.env('inv-3'), MYGIT_ASKPASS_NODE: process.execPath };
    // Async: the server answers on this process's event loop.
    const { stdout } = await promisify(execFile)(path.join(root, 'media', 'askpass.sh'), ["Password for 'https://h': "], { env, timeout: 5000 });
    expect(stdout).toBe("answer for Password for 'https://h': \n");
  });
});
