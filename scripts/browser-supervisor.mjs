import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync('data/browser-supervisor.pid', String(process.pid), { mode: 0o600 });
let child;
let stopping = false;
let retry;
function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/profile-host.ts'], { stdio: 'inherit' });
  child.on('exit', () => {
    if (stopping) process.exit(0);
    console.error('Browser host exited; restarting in 20 seconds.');
    retry = setTimeout(start, 20000);
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;
  clearTimeout(retry);
  if (child && child.exitCode === null) child.kill('SIGTERM');
  else process.exit(0);
});
start();
