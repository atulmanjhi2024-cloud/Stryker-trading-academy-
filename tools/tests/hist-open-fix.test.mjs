// release.sh runs non-browser tests with node: run the hermetic python test (synthetic data only, no /opt, no network).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync('python3', [join(here, 'hist-open-fix-test.py')], { cwd: mkdtempSync(join(tmpdir(), 'hof-')), encoding: 'utf8' });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
if (r.status !== 0) { console.log('FAIL hist-open-fix'); process.exit(1); }
