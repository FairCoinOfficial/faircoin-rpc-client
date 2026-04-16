# @fairco.in/rpc-client

JSON-RPC client for the FairCoin daemon (`faircoind`). Zero runtime dependencies, pure TypeScript, Node 20+.

Shared between the [FairCoin Explorer](https://github.com/FairCoinOfficial) and the WFAIR bridge as the single source of truth for faircoind wire calls.

## Install

```bash
bun add @fairco.in/rpc-client
# or
npm install @fairco.in/rpc-client
```

## Usage

### Quick start: env-configured client

The library reads the standard `FAIRCOIN_RPC_*` / `FAIRCOIN_TESTNET_RPC_*` environment variables used across the FairCoin ecosystem.

```ts
import { rpcWithNetwork, getBlockCount } from '@fairco.in/rpc-client';

const height = await getBlockCount('mainnet');

const block = await rpcWithNetwork<{ hash: string; tx: string[] }>(
  'getblock',
  ['0000000000000000000000000000000000000000000000000000000000000000', true],
  'mainnet',
);
```

### Explicit client

For tests, proxies, or multi-endpoint setups, construct a client directly:

```ts
import { FaircoinRpcClient } from '@fairco.in/rpc-client';

const client = new FaircoinRpcClient({
  rpcUser: 'fair',
  rpcPass: 'change_me',
  rpcHost: '127.0.0.1',
  rpcPort: '46373',
  rpcScheme: 'http',
});

const count = await client.call<number>('getblockcount');
```

### Custom endpoint URL

```ts
import { FaircoinRpcClient } from '@fairco.in/rpc-client';

const client = new FaircoinRpcClient({
  url: 'https://my-proxy.example/faircoin-rpc',
  rpcUser: 'fair',
  rpcPass: 'change_me',
});
```

## Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `FAIRCOIN_RPC_USER` | `fair` | Mainnet RPC username |
| `FAIRCOIN_RPC_PASS` | `change_me` | Mainnet RPC password |
| `FAIRCOIN_RPC_HOST` | `seed1.fairco.in` | Mainnet host |
| `FAIRCOIN_RPC_PORT` | `46373` | Mainnet port |
| `FAIRCOIN_RPC_SCHEME` | `http` | `http` or `https` |
| `FAIRCOIN_TESTNET_RPC_USER` | `${FAIRCOIN_RPC_USER}` | Testnet username |
| `FAIRCOIN_TESTNET_RPC_PASS` | `${FAIRCOIN_RPC_PASS}` | Testnet password |
| `FAIRCOIN_TESTNET_RPC_HOST` | `127.0.0.1` | Testnet host |
| `FAIRCOIN_TESTNET_RPC_PORT` | `46375` | Testnet port |
| `FAIRCOIN_TESTNET_RPC_SCHEME` | `http` | `http` or `https` |

## API

- `rpc(method, params?)` / `rpcWithNetwork(method, params?, network?)` — one-shot calls using env-configured credentials.
- `FaircoinRpcClient` — reusable per-endpoint client.
- `createClientForNetwork(network, env?, overrides?)` — build a client from env vars with optional overrides.
- `readNetworkConfigFromEnv(network, env?)` — inspect which host/credentials would be used.
- Typed helpers: `getBlockCount`, `getBlockHash`, `getBlock`, `getRawTransactionVerbose` (and their `*Mainnet` aliases).

## Design notes

- **Stateless.** The client holds no mutable state; share instances freely.
- **No caching.** Caching is the consumer's concern (e.g. Explorer backs calls with MongoDB; bridges typically don't cache).
- **Minifier-safe coercion.** `getblock`'s verbose flag is coerced to boolean; `getrawtransaction`'s verbose flag is coerced to integer. Some minifiers rewrite booleans to `0`/`1`, which would otherwise ship the wrong wire type.

## License

MIT
