/**
 * Provider API keys for the API-key host and the Claude host.
 *
 * The teacher's key is theirs: it is encrypted with the OS keychain through
 * Electron safeStorage, handed to a provider factory as an explicit `apiKey`
 * option, and sent only to the provider it belongs to. It is never written into
 * `process.env`, never placed in the MCP sidecar's environment, and never sent
 * to OpenRoom.
 *
 * One carve-out: the `anthropic` key is also the Claude host's credential. It
 * goes into the environment of that turn's Agent SDK subprocess as
 * ANTHROPIC_API_KEY (`claudeApiKeyEnv` in `hosts/claude.ts`), and nowhere else.
 */
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ByokProviderId =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'mistral'
  | 'groq'
  | 'openrouter'
  | 'cloudflare';

export const BYOK_PROVIDER_IDS: readonly ByokProviderId[] = [
  'openai',
  'google',
  'anthropic',
  'mistral',
  'groq',
  'openrouter',
  'cloudflare',
];

export function isByokProviderId(value: unknown): value is ByokProviderId {
  return typeof value === 'string' && (BYOK_PROVIDER_IDS as readonly string[]).includes(value);
}

export interface ByokCredential {
  apiKey: string;
  /** Cloudflare only: the account the Workers AI endpoint is scoped to. */
  accountId?: string;
}

export interface ByokKeyStatus {
  providerId: ByokProviderId;
  hasKey: boolean;
  /** Configuration, not a credential — safe to show in settings without a decrypt. */
  accountId: string | null;
  /** True when the key comes from the environment and cannot be edited here. */
  fromEnv: boolean;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface AgentKeyStoreDeps {
  file(): string;
  /** Resolved per call: Electron's safeStorage is absent in tests and on some Linux desktops. */
  safeStorage(): SafeStorageLike | null;
  env?: NodeJS.ProcessEnv;
  readFile?(path: string): Promise<string>;
  writeFile?(path: string, text: string): Promise<void>;
}

export interface AgentKeyStore {
  /** False when the computer has no OS keychain; keys can then only come from the environment. */
  available(): boolean;
  list(): Promise<ByokKeyStatus[]>;
  set(id: ByokProviderId, credential: ByokCredential): Promise<void>;
  clear(id: ByokProviderId): Promise<void>;
  resolve(id: ByokProviderId): Promise<ByokCredential | null>;
  configured(): Promise<ByokProviderId[]>;
}

export const NO_KEYCHAIN_MESSAGE =
  'This computer has no OS keychain, so OpenRoom will not store an API key on disk.';

interface StoredProvider {
  secret?: string;
  accountId?: string;
}

interface StoredKeys {
  version: 1;
  providers: Partial<Record<ByokProviderId, StoredProvider>>;
}

function envName(id: ByokProviderId, suffix: 'API_KEY' | 'ACCOUNT_ID'): string {
  return `OPENROOM_BYOK_${id.toUpperCase()}_${suffix}`;
}

/** Environment keys are an escape hatch for computers without a keychain: read, never written. */
function envCredential(id: ByokProviderId, env: NodeJS.ProcessEnv): ByokCredential | null {
  const apiKey = env[envName(id, 'API_KEY')];
  if (apiKey === undefined || apiKey === '') return null;
  const accountId = env[envName(id, 'ACCOUNT_ID')];
  return accountId === undefined || accountId === '' ? { apiKey } : { apiKey, accountId };
}

/** Same atomic tmp-then-rename shape as session-store, with owner-only permissions. */
async function writeSecretFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

export function createAgentKeyStore(deps: AgentKeyStoreDeps): AgentKeyStore {
  const env = deps.env ?? process.env;
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const write = deps.writeFile ?? writeSecretFile;

  const load = async (): Promise<StoredKeys> => {
    try {
      const parsed = JSON.parse(await read(deps.file())) as StoredKeys;
      return parsed.providers === undefined ? { version: 1, providers: {} } : parsed;
    } catch {
      return { version: 1, providers: {} };
    }
  };

  const save = (keys: StoredKeys): Promise<void> => write(deps.file(), `${JSON.stringify(keys, null, 2)}\n`);

  const available = (): boolean => {
    try {
      return deps.safeStorage()?.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  };

  const decrypt = (secret: string | undefined): string | null => {
    if (secret === undefined || secret === '' || !available()) return null;
    try {
      const store = deps.safeStorage();
      if (store === null) return null;
      const plain = store.decryptString(Buffer.from(secret, 'base64'));
      return plain === '' ? null : plain;
    } catch {
      return null;
    }
  };

  return {
    available,

    async list() {
      const stored = await load();
      return BYOK_PROVIDER_IDS.map((providerId) => {
        const fromEnv = envCredential(providerId, env);
        const entry = stored.providers[providerId];
        return {
          providerId,
          hasKey: fromEnv !== null || (entry?.secret ?? '') !== '',
          accountId: fromEnv?.accountId ?? entry?.accountId ?? null,
          fromEnv: fromEnv !== null,
        };
      });
    },

    async set(id, credential) {
      if (credential.apiKey.trim() === '') throw new Error('Enter an API key.');
      if (id === 'cloudflare' && (credential.accountId ?? '').trim() === '') {
        throw new Error('Cloudflare Workers AI needs an account ID.');
      }
      const store = deps.safeStorage();
      if (store === null || !available()) throw new Error(NO_KEYCHAIN_MESSAGE);
      const stored = await load();
      const secret = store.encryptString(credential.apiKey.trim()).toString('base64');
      const accountId = (credential.accountId ?? '').trim();
      stored.providers[id] = accountId === '' ? { secret } : { secret, accountId };
      await save(stored);
    },

    async clear(id) {
      const stored = await load();
      if (stored.providers[id] === undefined) return;
      delete stored.providers[id];
      await save(stored);
    },

    async resolve(id) {
      const fromEnv = envCredential(id, env);
      if (fromEnv !== null) return fromEnv;
      const entry = (await load()).providers[id];
      const apiKey = decrypt(entry?.secret);
      if (apiKey === null) return null;
      const accountId = entry?.accountId ?? '';
      return accountId === '' ? { apiKey } : { apiKey, accountId };
    },

    async configured() {
      return (await this.list()).filter((status) => status.hasKey).map((status) => status.providerId);
    },
  };
}

export function defaultKeyFile(userData: string): string {
  return join(userData, 'agent-keys.json');
}
