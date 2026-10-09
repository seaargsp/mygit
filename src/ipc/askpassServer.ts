import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InteractiveBridge, PauseHandle } from '../git/gitService';
import { IDLE_TIMEOUT_MS, MAX_REQUEST_BYTES, tokensMatch, type AskpassRequest } from './askpassProtocol';

export type Prompter = (prompt: string) => Promise<string | undefined>;

type StartOptions = { extensionPath: string; prompter: Prompter; onReject?: (reason: string) => void };

/**
 * Credential prompts for git and ssh over a unix socket (0600, in a 0700 directory) or a
 * named pipe. Every request must carry the per-session token, passed to the shim only
 * through the environment.
 */
export class AskpassServer implements InteractiveBridge {
  private readonly invocations = new Map<string, PauseHandle>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly server: net.Server,
    readonly handle: string,
    private readonly token: string,
    private readonly dir: string | null,
    private readonly extensionPath: string,
    private readonly prompter: Prompter,
    private readonly onReject: (reason: string) => void
  ) {}

  static async start(opts: StartOptions): Promise<AskpassServer> {
    const token = crypto.randomBytes(32).toString('hex');
    let handle: string;
    let dir: string | null = null;
    if (process.platform === 'win32') {
      handle = `\\\\.\\pipe\\mygit-askpass-${crypto.randomBytes(16).toString('hex')}`;
    } else {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mygit-askpass-'));
      await fs.chmod(dir, 0o700);
      handle = path.join(dir, 'askpass.sock');
      await fs.chmod(path.join(opts.extensionPath, 'media', 'askpass.sh'), 0o755).catch(() => undefined);
    }
    let instance: AskpassServer | undefined;
    const server = net.createServer(socket => {
      if (instance) instance.onConnection(socket);
      else socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(handle, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.unref();
    if (dir) await fs.chmod(handle, 0o600);
    instance = new AskpassServer(server, handle, token, dir, opts.extensionPath, opts.prompter, opts.onReject ?? (() => undefined));
    return instance;
  }

  tokenForTests(): string {
    return this.token;
  }

  env(id: string): Record<string, string> {
    const script = path.join(this.extensionPath, 'media', 'askpass.sh');
    return {
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      SSH_ASKPASS_REQUIRE: 'force',
      ...(process.platform === 'win32' ? {} : { DISPLAY: process.env.DISPLAY || ':0' }),
      MYGIT_ASKPASS_NODE: process.execPath,
      MYGIT_ASKPASS_MAIN: path.join(this.extensionPath, 'dist', 'askpass-main.js'),
      MYGIT_ASKPASS_HANDLE: this.handle,
      MYGIT_ASKPASS_TOKEN: this.token,
      MYGIT_ASKPASS_ID: id,
    };
  }

  register(id: string, timer: PauseHandle): () => void {
    this.invocations.set(id, timer);
    return () => this.invocations.delete(id);
  }

  private onConnection(socket: net.Socket): void {
    let buffer = Buffer.alloc(0);
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REQUEST_BYTES) {
        this.onReject('askpass: request too large');
        socket.destroy();
        return;
      }
      const end = buffer.indexOf(0x0a);
      if (end === -1) return;
      socket.off('data', onData);
      void this.answer(socket, buffer.subarray(0, end).toString('utf8'));
    };
    socket.on('data', onData);
  }

  private async answer(socket: net.Socket, line: string): Promise<void> {
    let request: Partial<AskpassRequest>;
    try {
      request = JSON.parse(line) as Partial<AskpassRequest>;
    } catch {
      socket.destroy();
      return;
    }
    if (!tokensMatch(this.token, request.token)) {
      this.onReject('askpass: rejected connection');
      socket.destroy();
      return;
    }
    const prompt = typeof request.prompt === 'string' ? request.prompt.slice(0, 1024) : 'Password: ';
    const timer = typeof request.id === 'string' ? this.invocations.get(request.id) : undefined;
    timer?.pause();
    // One input box at a time.
    const run = () => this.prompter(prompt);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    const value = await result.catch(() => undefined);
    timer?.resume();
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(value === undefined ? { ok: false } : { ok: true, value })}\n`);
  }

  dispose(): void {
    this.server.close();
    if (this.dir) void fs.rm(this.dir, { recursive: true, force: true });
  }
}
