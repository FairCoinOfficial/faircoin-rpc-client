import type {
  NetworkConfig,
  NetworkType,
  RpcEnvelope,
  RpcParam,
  RpcRequestBody,
} from './types.js';

/**
 * Methods whose numeric param is actually a boolean flag. Some minifiers
 * rewrite boolean literals to 0/1 which would ship the wrong wire type to
 * faircoind. We coerce explicitly.
 */
const BOOL_PARAM_INDICES: Readonly<Record<string, readonly number[]>> = {
  getblock: [1],
};

/**
 * Methods whose boolean param is actually an integer flag. `getrawtransaction`
 * expects `1`/`0` rather than `true`/`false`.
 */
const INT_PARAM_INDICES: Readonly<Record<string, readonly number[]>> = {
  getrawtransaction: [1],
};

function coerceParams(method: string, params: readonly RpcParam[]): RpcParam[] {
  const boolIdx = BOOL_PARAM_INDICES[method];
  const intIdx = INT_PARAM_INDICES[method];
  if (!boolIdx && !intIdx) {
    return [...params];
  }
  return params.map((param, index) => {
    if (boolIdx?.includes(index)) {
      return Boolean(param);
    }
    if (intIdx?.includes(index)) {
      return Number(param);
    }
    return param;
  });
}

function encodeBasicAuth(user: string, pass: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(`${user}:${pass}`).toString('base64');
  }
  return btoa(`${user}:${pass}`);
}

/**
 * Resolve a network config from environment variables. Mirrors the
 * `FAIRCOIN_RPC_*` / `FAIRCOIN_TESTNET_RPC_*` conventions used by the
 * FairCoin ecosystem (Explorer, WFAIR bridge).
 */
export function readNetworkConfigFromEnv(
  network: NetworkType,
  env: Record<string, string | undefined> = process.env,
): NetworkConfig {
  if (network === 'testnet') {
    return {
      rpcUser: env.FAIRCOIN_TESTNET_RPC_USER ?? env.FAIRCOIN_RPC_USER ?? 'fair',
      rpcPass: env.FAIRCOIN_TESTNET_RPC_PASS ?? env.FAIRCOIN_RPC_PASS ?? 'change_me',
      rpcHost: env.FAIRCOIN_TESTNET_RPC_HOST ?? '127.0.0.1',
      rpcPort: env.FAIRCOIN_TESTNET_RPC_PORT ?? '46375',
      rpcScheme: env.FAIRCOIN_TESTNET_RPC_SCHEME ?? 'http',
    };
  }
  return {
    rpcUser: env.FAIRCOIN_RPC_USER ?? 'fair',
    rpcPass: env.FAIRCOIN_RPC_PASS ?? 'change_me',
    rpcHost: env.FAIRCOIN_RPC_HOST ?? 'seed1.fairco.in',
    rpcPort: env.FAIRCOIN_RPC_PORT ?? '46373',
    rpcScheme: env.FAIRCOIN_RPC_SCHEME ?? 'http',
  };
}

/**
 * Minimal `fetch`-like surface we rely on. Typed as a subset of the platform
 * `fetch` so consumers can inject a mock in tests without pulling DOM lib
 * types into the library build.
 */
export type FetchLike = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export interface FaircoinRpcClientOptions {
  /** Full endpoint URL, e.g. `http://127.0.0.1:46373/`. Takes precedence over discrete host/port/scheme. */
  url?: string;
  rpcUser?: string;
  rpcPass?: string;
  rpcHost?: string;
  rpcPort?: string;
  rpcScheme?: string;
  /** Override the fetch implementation (useful for tests, proxies, retries). */
  fetchImpl?: FetchLike;
  /**
   * Abort a call after this many milliseconds. A wedged or slow node must never
   * hang a caller indefinitely, so requests are time-bounded. Defaults to
   * {@link DEFAULT_RPC_TIMEOUT_MS}. Set `0` to disable.
   */
  timeoutMs?: number;
}

/** Default per-call timeout: a healthy node answers in milliseconds. */
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

function resolveUrl(opts: FaircoinRpcClientOptions, fallback: NetworkConfig): string {
  if (opts.url) return opts.url;
  const scheme = opts.rpcScheme ?? fallback.rpcScheme;
  const host = opts.rpcHost ?? fallback.rpcHost;
  const port = opts.rpcPort ?? fallback.rpcPort;
  return `${scheme}://${host}:${port}/`;
}

/**
 * A stateless FairCoin JSON-RPC client. One instance per endpoint.
 * Thread-safe (no mutable state) — reuse freely across requests.
 */
export class FaircoinRpcClient {
  private readonly url: string;
  private readonly authHeader: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: FaircoinRpcClientOptions & { rpcUser: string; rpcPass: string }) {
    const baseline: NetworkConfig = {
      rpcUser: options.rpcUser,
      rpcPass: options.rpcPass,
      rpcHost: options.rpcHost ?? '127.0.0.1',
      rpcPort: options.rpcPort ?? '46373',
      rpcScheme: options.rpcScheme ?? 'http',
    };
    this.url = resolveUrl(options, baseline);
    this.authHeader = `Basic ${encodeBasicAuth(options.rpcUser, options.rpcPass)}`;
    const runtimeFetch = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!runtimeFetch) {
      throw new Error('FaircoinRpcClient requires a fetch implementation (Node >=20 or options.fetchImpl).');
    }
    this.fetchImpl = runtimeFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  }

  /**
   * Issue a single JSON-RPC call. Throws on HTTP failure or RPC error
   * response with an informative message.
   */
  async call<T>(method: string, params: readonly RpcParam[] = []): Promise<T> {
    const body: RpcRequestBody = {
      jsonrpc: '2.0',
      method,
      params: coerceParams(method, params),
      id: 'faircoin-rpc-client',
    };

    // Bound the request so a wedged or unreachable node can never hang the
    // caller. `AbortController` cancels the underlying socket on timeout.
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer =
      controller !== undefined ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error(`RPC ${method} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`);
    }

    const envelope = (await response.json()) as RpcEnvelope<T>;
    if (envelope.error) {
      throw new Error(`RPC ${envelope.error.code}: ${envelope.error.message}`);
    }
    return envelope.result;
  }
}

/** Parse a millisecond timeout from an env string; `undefined` if unset or not a finite number. */
function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Build a client for a named FairCoin network using environment variables.
 * Reads `FAIRCOIN_RPC_*` for mainnet and `FAIRCOIN_TESTNET_RPC_*` for
 * testnet (with fallback to the mainnet vars).
 */
export function createClientForNetwork(
  network: NetworkType = 'mainnet',
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<FaircoinRpcClientOptions> = {},
): FaircoinRpcClient {
  const config = readNetworkConfigFromEnv(network, env);
  return new FaircoinRpcClient({
    rpcUser: overrides.rpcUser ?? config.rpcUser,
    rpcPass: overrides.rpcPass ?? config.rpcPass,
    rpcHost: overrides.rpcHost ?? config.rpcHost,
    rpcPort: overrides.rpcPort ?? config.rpcPort,
    rpcScheme: overrides.rpcScheme ?? config.rpcScheme,
    url: overrides.url,
    fetchImpl: overrides.fetchImpl,
    timeoutMs: overrides.timeoutMs ?? parseTimeoutMs(env.FAIRCOIN_RPC_TIMEOUT_MS),
  });
}

/**
 * Cached singleton clients keyed by network. Created lazily so importing
 * this module doesn't crash when env vars are missing.
 */
const defaultClients: Partial<Record<NetworkType, FaircoinRpcClient>> = {};

function getDefaultClient(network: NetworkType): FaircoinRpcClient {
  const existing = defaultClients[network];
  if (existing) return existing;
  const client = createClientForNetwork(network);
  defaultClients[network] = client;
  return client;
}

/**
 * Call any RPC method against the named network using env-configured
 * credentials. Convenience wrapper over {@link createClientForNetwork}.
 */
export async function rpcWithNetwork<T>(
  method: string,
  params: readonly RpcParam[] = [],
  network: NetworkType = 'mainnet',
): Promise<T> {
  return getDefaultClient(network).call<T>(method, params);
}

/**
 * Call any RPC method against mainnet. Historical alias kept for
 * compatibility with the Explorer call-sites.
 */
export async function rpc<T>(method: string, params: readonly RpcParam[] = []): Promise<T> {
  return rpcWithNetwork<T>(method, params, 'mainnet');
}

// --- Typed helpers for the most common RPC methods ---------------------------
// The FairCoin daemon returns rich, method-specific JSON shapes. The library
// keeps the return types as `unknown` on the raw helpers and lets callers
// narrow — we don't want to ship stale schema snapshots here. Primitive helpers
// (getblockcount, getblockhash) keep concrete return types.

export const getBlockCount = (network: NetworkType = 'mainnet'): Promise<number> =>
  rpcWithNetwork<number>('getblockcount', [], network);

export const getBlockHash = (height: number, network: NetworkType = 'mainnet'): Promise<string> =>
  rpcWithNetwork<string>('getblockhash', [height], network);

export const getBlock = (hash: string, network: NetworkType = 'mainnet'): Promise<unknown> =>
  rpcWithNetwork<unknown>('getblock', [hash, true], network);

export const getRawTransactionVerbose = (
  txid: string,
  network: NetworkType = 'mainnet',
): Promise<unknown> => rpcWithNetwork<unknown>('getrawtransaction', [txid, 1], network);

// Legacy mainnet-specific aliases — preserved for backward compatibility with
// callers that predate the `network` parameter.
export const getBlockCountMainnet = (): Promise<number> => getBlockCount('mainnet');
export const getBlockHashMainnet = (height: number): Promise<string> => getBlockHash(height, 'mainnet');
export const getBlockMainnet = (hash: string): Promise<unknown> => getBlock(hash, 'mainnet');
export const getRawTransactionVerboseMainnet = (txid: string): Promise<unknown> =>
  getRawTransactionVerbose(txid, 'mainnet');
