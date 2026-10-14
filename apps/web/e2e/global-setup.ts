import { execSync } from 'node:child_process';
import path from 'node:path';

/** Reset the TEST database and create the fictional accounts from users.json before any test. */
export default function globalSetup() {
  execSync('npm run e2e:prepare -w @gms/server', {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
