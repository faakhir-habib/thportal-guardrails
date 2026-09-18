import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from './repo.mjs';

// The bws access token is stored DPAPI-encrypted on this machine, so it can only be read by this
// Windows user, on this machine, through PowerShell. It is passed to bws as an environment variable
// for one call and never written anywhere.
const bwsAccessToken = () => {
  if (process.env.BWS_ACCESS_TOKEN) return process.env.BWS_ACCESS_TOKEN;

  const file = config().bitwarden?.tokenFile;
  if (!file || !existsSync(file)) return null;

  const script = `[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-Content '${file}' | ConvertTo-SecureString)))`;
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
};

const defaultRunBws = () => {
  const token = bwsAccessToken();
  if (!token) throw new Error('no bws access token (set BWS_ACCESS_TOKEN or configure bitwarden.tokenFile)');

  const env = { ...process.env, BWS_ACCESS_TOKEN: token };
  const wanted = config().bitwarden.project;

  const projects = JSON.parse(execFileSync('bws', ['project', 'list', '-o', 'json'], { encoding: 'utf8', env }));
  const project = projects.find((p) => p.name === wanted);
  if (!project) throw new Error(`the Bitwarden project "${wanted}" is not visible to this bws token`);

  return execFileSync('bws', ['secret', 'list', project.id, '-o', 'json'], { encoding: 'utf8', env });
};

export function getSecret(key, { env = process.env, runBws = defaultRunBws } = {}) {
  if (env[key]) return env[key];

  let listed = '[]';
  try {
    listed = runBws();
  } catch (error) {
    const first = String(error.message).split('\n')[0];
    throw new Error(`could not read ${key} from Bitwarden (${first}). Set ${key} in your environment instead.`);
  }

  const found = JSON.parse(listed).find((s) => s.key === key);
  if (found?.value) return found.value;

  const project = config().bitwarden?.project ?? 'Work';
  throw new Error(`${key} was not found. Set it in your environment, or make it readable in the Bitwarden project "${project}".`);
}
