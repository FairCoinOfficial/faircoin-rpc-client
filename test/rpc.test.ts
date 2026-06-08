import { describe, expect, test } from 'bun:test';
import {
  FaircoinRpcClient,
  createClientForNetwork,
  readNetworkConfigFromEnv,
  type FetchLike,
} from '../src/index.js';

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

function makeMockFetch(responder: (req: CapturedRequest) => {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json: unknown;
}): { fetchImpl: FetchLike; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const captured: CapturedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    calls.push(captured);
    const result = responder(captured);
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      statusText: result.statusText ?? 'OK',
      json: async () => result.json,
    };
  };
  return { fetchImpl, calls };
}

describe('FaircoinRpcClient', () => {
  test('constructs a JSON-RPC body with method, params and id', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: 42, error: null, id: 'faircoin-rpc-client' },
    }));
    const client = new FaircoinRpcClient({
      rpcUser: 'u',
      rpcPass: 'p',
      rpcHost: 'example.invalid',
      rpcPort: '12345',
      rpcScheme: 'http',
      fetchImpl,
    });

    const result = await client.call<number>('getblockcount');
    expect(result).toBe(42);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    expect(call.url).toBe('http://example.invalid:12345/');
    expect(call.method).toBe('POST');
    expect(call.headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(call.body) as {
      jsonrpc: string;
      method: string;
      params: unknown[];
      id: string;
    };
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('getblockcount');
    expect(parsed.params).toEqual([]);
    expect(parsed.id).toBe('faircoin-rpc-client');
  });

  test('sends Basic auth header built from user and password', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: true, error: null, id: null },
    }));
    const client = new FaircoinRpcClient({
      rpcUser: 'alice',
      rpcPass: 's3cret',
      fetchImpl,
    });
    await client.call('ping');
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    const expected = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`;
    expect(call.headers.Authorization).toBe(expected);
  });

  test('coerces getblock verbose flag to boolean', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: {}, error: null, id: null },
    }));
    const client = new FaircoinRpcClient({ rpcUser: 'u', rpcPass: 'p', fetchImpl });
    await client.call('getblock', ['deadbeef', 1]);
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    const parsed = JSON.parse(call.body) as { params: unknown[] };
    expect(parsed.params).toEqual(['deadbeef', true]);
  });

  test('coerces getrawtransaction verbose flag to integer', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: {}, error: null, id: null },
    }));
    const client = new FaircoinRpcClient({ rpcUser: 'u', rpcPass: 'p', fetchImpl });
    await client.call('getrawtransaction', ['abc123', true]);
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    const parsed = JSON.parse(call.body) as { params: unknown[] };
    expect(parsed.params).toEqual(['abc123', 1]);
  });

  test('throws a descriptive error on HTTP failure', async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: {},
    }));
    const client = new FaircoinRpcClient({ rpcUser: 'u', rpcPass: 'p', fetchImpl });
    await expect(client.call('getblockcount')).rejects.toThrow(
      /RPC HTTP 503: Service Unavailable/,
    );
  });

  test('throws on RPC error payload with code and message', async () => {
    const { fetchImpl } = makeMockFetch(() => ({
      json: { result: null, error: { code: -32601, message: 'Method not found' }, id: null },
    }));
    const client = new FaircoinRpcClient({ rpcUser: 'u', rpcPass: 'p', fetchImpl });
    await expect(client.call('bogus')).rejects.toThrow(/RPC -32601: Method not found/);
  });

  test('honours the explicit `url` option over discrete host/port', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: 0, error: null, id: null },
    }));
    const client = new FaircoinRpcClient({
      rpcUser: 'u',
      rpcPass: 'p',
      rpcHost: 'ignored',
      rpcPort: '1',
      url: 'https://custom.example/rpc',
      fetchImpl,
    });
    await client.call('getblockcount');
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    expect(call.url).toBe('https://custom.example/rpc');
  });
});

describe('readNetworkConfigFromEnv', () => {
  test('routes mainnet to FAIRCOIN_RPC_* vars', () => {
    const config = readNetworkConfigFromEnv('mainnet', {
      FAIRCOIN_RPC_USER: 'm-user',
      FAIRCOIN_RPC_PASS: 'm-pass',
      FAIRCOIN_RPC_HOST: 'mainnet.example',
      FAIRCOIN_RPC_PORT: '46373',
      FAIRCOIN_RPC_SCHEME: 'https',
    });
    expect(config).toEqual({
      rpcUser: 'm-user',
      rpcPass: 'm-pass',
      rpcHost: 'mainnet.example',
      rpcPort: '46373',
      rpcScheme: 'https',
    });
  });

  test('routes testnet to FAIRCOIN_TESTNET_RPC_* with fallback to mainnet vars', () => {
    const config = readNetworkConfigFromEnv('testnet', {
      FAIRCOIN_RPC_USER: 'fallback-user',
      FAIRCOIN_RPC_PASS: 'fallback-pass',
      FAIRCOIN_TESTNET_RPC_HOST: 'testnet.example',
      FAIRCOIN_TESTNET_RPC_PORT: '46375',
    });
    expect(config.rpcUser).toBe('fallback-user');
    expect(config.rpcPass).toBe('fallback-pass');
    expect(config.rpcHost).toBe('testnet.example');
    expect(config.rpcPort).toBe('46375');
    expect(config.rpcScheme).toBe('http');
  });
});

describe('createClientForNetwork', () => {
  test('produces a working client from env vars', async () => {
    const { fetchImpl, calls } = makeMockFetch(() => ({
      json: { result: 7, error: null, id: null },
    }));
    const client = createClientForNetwork(
      'testnet',
      {
        FAIRCOIN_TESTNET_RPC_USER: 't',
        FAIRCOIN_TESTNET_RPC_PASS: 't',
        FAIRCOIN_TESTNET_RPC_HOST: 'tn.example',
        FAIRCOIN_TESTNET_RPC_PORT: '46375',
      },
      { fetchImpl },
    );
    const value = await client.call<number>('getblockcount');
    expect(value).toBe(7);
    const call = calls[0];
    if (!call) throw new Error('expected at least one captured call');
    expect(call.url).toBe('http://tn.example:46375/');
  });
});

describe('request timeout', () => {
  test('aborts a call that exceeds timeoutMs', async () => {
    // A fetch that never resolves until the client aborts it via the signal.
    const slowFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as { name: string }).name = 'AbortError';
          reject(err);
        });
      });
    const client = new FaircoinRpcClient({
      rpcUser: 'u',
      rpcPass: 'p',
      url: 'http://node/',
      fetchImpl: slowFetch,
      timeoutMs: 50,
    });
    await expect(client.call('getblockcount')).rejects.toThrow(/timed out after 50ms/);
  });

  test('a fast call resolves normally under the timeout', async () => {
    const { fetchImpl } = makeMockFetch(() => ({ json: { result: 42, error: null } }));
    const client = new FaircoinRpcClient({
      rpcUser: 'u',
      rpcPass: 'p',
      url: 'http://node/',
      fetchImpl,
      timeoutMs: 1000,
    });
    expect(await client.call<number>('getblockcount')).toBe(42);
  });
});
