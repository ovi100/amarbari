import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Minimal key/value contract the app relies on for OTP caching, OTP rate
 * limiting and refresh-token blacklisting (SRS 2.2).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  flush(): Promise<void>;
  disconnect(): Promise<void>;
}

/** In-process fallback used when Redis is unreachable and REDIS_OPTIONAL is on. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, { value: string; expiresAt: number | null }>();

  private read(key: string) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string) {
    return this.read(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    this.map.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string) {
    this.map.delete(key);
  }

  async incr(key: string, ttlSeconds: number) {
    const entry = this.read(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.map.set(key, {
      value: String(next),
      expiresAt: entry?.expiresAt ?? Date.now() + ttlSeconds * 1000,
    });
    return next;
  }

  async ttl(key: string) {
    const entry = this.read(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async exists(key: string) {
    return this.read(key) !== null;
  }

  async flush() {
    this.map.clear();
  }

  async disconnect() {
    this.map.clear();
  }
}

class RedisStore implements KeyValueStore {
  constructor(private readonly client: Redis) {}

  get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number) {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }

  ttl(key: string) {
    return this.client.ttl(key);
  }

  async exists(key: string) {
    return (await this.client.exists(key)) === 1;
  }

  async flush() {
    await this.client.flushdb();
  }

  async disconnect() {
    this.client.disconnect();
  }
}

let store: KeyValueStore = new MemoryStore();
let redisClient: Redis | null = null;
let mode: 'redis' | 'memory' = 'memory';

/**
 * Connects to Redis once at boot. If the connection fails and
 * `REDIS_OPTIONAL` is enabled we degrade to {@link MemoryStore} instead of
 * crashing, so the API is runnable without local infrastructure.
 */
export async function initKeyValueStore(): Promise<KeyValueStore> {
  if (env.isTest) {
    mode = 'memory';
    store = new MemoryStore();
    return store;
  }

  const client = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on('error', () => {
    /* handled below; suppressed to avoid unhandled error spam */
  });

  try {
    await client.connect();
    await client.ping();
    redisClient = client;
    store = new RedisStore(client);
    mode = 'redis';
    logger.info(`Redis connected at ${env.redisUrl}`);
  } catch (error) {
    client.disconnect();
    if (!env.redisOptional) {
      throw new Error(
        `Redis is required but unreachable at ${env.redisUrl}: ${(error as Error).message}`
      );
    }
    mode = 'memory';
    store = new MemoryStore();
    logger.warn(
      `Redis unreachable at ${env.redisUrl} — falling back to in-memory store. ` +
        'OTPs and token blacklists will not survive a restart or scale beyond one process.'
    );
  }
  return store;
}

export function getStore(): KeyValueStore {
  return store;
}

export function getStoreMode(): 'redis' | 'memory' {
  return mode;
}

/** Raw client, used only for the Socket.io Redis adapter. Null in memory mode. */
export function getRedisClient(): Redis | null {
  return redisClient;
}

export async function closeKeyValueStore() {
  await store.disconnect();
  redisClient = null;
}
