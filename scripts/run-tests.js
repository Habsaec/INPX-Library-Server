import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledNode = path.join(rootDir, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const nodeBin = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
const testDir = path.join(rootDir, 'test');
const testEnvUrl = pathToFileURL(path.join(testDir, 'test-env.js')).href;
const testFiles = fs.readdirSync(testDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => path.join(testDir, entry.name))
  .sort();

const result = spawnSync(
  nodeBin,
  [
    '--import',
    testEnvUrl,
    '--test',
    ...testFiles,
  ],
  { cwd: rootDir, stdio: 'inherit' }
);

process.exit(result.status ?? 1);
