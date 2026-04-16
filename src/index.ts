export type {
  NetworkConfig,
  NetworkType,
  RpcEnvelope,
  RpcErrorPayload,
  RpcParam,
  RpcRequestBody,
} from './types.js';

export {
  FaircoinRpcClient,
  createClientForNetwork,
  readNetworkConfigFromEnv,
  rpc,
  rpcWithNetwork,
  getBlock,
  getBlockCount,
  getBlockCountMainnet,
  getBlockHash,
  getBlockHashMainnet,
  getBlockMainnet,
  getRawTransactionVerbose,
  getRawTransactionVerboseMainnet,
} from './rpc.js';

export type { FaircoinRpcClientOptions, FetchLike } from './rpc.js';
