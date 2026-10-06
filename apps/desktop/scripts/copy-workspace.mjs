import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../renderer/host');
await rm(resolve(here, '../renderer'), { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(here, '../../workspace/dist'), target, { recursive: true });
