// Entry run by media/askpass.sh as GIT_ASKPASS / SSH_ASKPASS: prints the answer on stdout.
import { requestCredential } from './askpassClient';

async function main(): Promise<void> {
  const handle = process.env.MYGIT_ASKPASS_HANDLE;
  const token = process.env.MYGIT_ASKPASS_TOKEN;
  const id = process.env.MYGIT_ASKPASS_ID;
  if (!handle || !token || !id) process.exit(1);
  const prompt = process.argv.slice(2).join(' ') || 'Password: ';
  const value = await requestCredential(handle, { token, id, prompt });
  if (value === null) process.exit(1);
  process.stdout.write(`${value}\n`);
  process.exit(0);
}

void main();
