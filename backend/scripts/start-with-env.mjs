import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, '.env.local');
const args = process.argv.slice(2);

const env = {
  ...process.env,
};

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
}

if (!env.NODE_OPTIONS) {
  env.NODE_OPTIONS = '--use-system-ca';
}

const child = spawn(
  process.execPath,
  [...args, 'src/server.mjs'],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);

child.on('exit', code => {
  process.exit(code ?? 0);
});
