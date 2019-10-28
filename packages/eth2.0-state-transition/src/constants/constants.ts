/**
 * @module constants
 */

export const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5; // 32
export const GENESIS_SLOT = 0;
export const GENESIS_EPOCH = 0;
export const GENESIS_START_SHARD = 0;
export const FAR_FUTURE_EPOCH = Infinity;
export const ZERO_HASH = Buffer.alloc(32, 0);
export const EMPTY_SIGNATURE = Buffer.alloc(96, 0);
export const SECONDS_PER_DAY = 86400;

// Signature domains
export enum DomainType {
  BEACON_PROPOSER = 0,
  RANDAO = 1,
  ATTESTATION = 2,
  DEPOSIT = 3,
  VOLUNTARY_EXIT = 4,
  TRANSFER = 5,
}
