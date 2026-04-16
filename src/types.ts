/**
 * JSON-RPC 2.0 response envelope.
 * FairCoin follows the Bitcoin Core convention where `result` is null on error
 * and `error` carries the failure payload.
 */
export interface RpcErrorPayload {
  code: number;
  message: string;
}

export type RpcEnvelope<T> = {
  result: T;
  error: RpcErrorPayload | null;
  id: string | number | null;
};

/**
 * Connection parameters for a single faircoind endpoint.
 */
export interface NetworkConfig {
  rpcUser: string;
  rpcPass: string;
  rpcHost: string;
  rpcPort: string;
  rpcScheme: string;
}

/**
 * Supported FairCoin networks. `mainnet` is the public chain, `testnet` is
 * the public test chain (separate faircoind instance, different ports).
 */
export type NetworkType = 'mainnet' | 'testnet';

/**
 * Parameters accepted by the RPC call primitive.
 * `params` may contain anything JSON-serialisable — the FairCoin daemon
 * validates shape per-method.
 */
export type RpcParam =
  | string
  | number
  | boolean
  | null
  | RpcParam[]
  | { [key: string]: RpcParam };

export interface RpcRequestBody {
  jsonrpc: '2.0';
  method: string;
  params: RpcParam[];
  id: string | number;
}
