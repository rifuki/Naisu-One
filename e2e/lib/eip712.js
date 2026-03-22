'use strict';

const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');
const bs58           = require('bs58');

// ── Primitives ────────────────────────────────────────────────────────────────

function keccak(data) {
  return Buffer.from(keccak_256(data));
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '');
  return Buffer.from(h.padStart(h.length + (h.length % 2), '0'), 'hex');
}

function pad32(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const out = Buffer.alloc(32);
  b.copy(out, 32 - b.length);
  return out;
}

function encodeUint(n) { return pad32(Buffer.from(BigInt(n).toString(16).padStart(64, '0'), 'hex')); }
function encodeAddress(hex) { return pad32(hexToBytes(hex)); }

// ── Key → Address ─────────────────────────────────────────────────────────────

function privToAddress(privHex) {
  const priv = hexToBytes(privHex);
  const pub  = secp256k1.getPublicKey(priv, false);   // uncompressed 65 bytes
  return '0x' + Buffer.from(keccak(pub.slice(1))).slice(12).toString('hex');
}

// ── EIP-712 ───────────────────────────────────────────────────────────────────

function domainSeparator({ name, version, chainId, verifyingContract }) {
  const typeHash = keccak(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
  );
  return keccak(Buffer.concat([
    typeHash,
    keccak(Buffer.from(name)),
    keccak(Buffer.from(version)),
    encodeUint(chainId),
    encodeAddress(verifyingContract),
  ]));
}

// Intent struct typeHash — must match smart contract
const INTENT_TYPE_HASH = keccak(
  'Intent(address creator,bytes32 recipient,uint16 destinationChain,' +
  'uint256 amount,uint256 startPrice,uint256 floorPrice,' +
  'uint256 deadline,uint8 intentType,uint256 nonce)'
);

function structHash(intent) {
  return keccak(Buffer.concat([
    INTENT_TYPE_HASH,
    encodeAddress(intent.creator),
    pad32(hexToBytes(intent.recipient)),
    encodeUint(intent.destinationChain),
    encodeUint(intent.amount),
    encodeUint(intent.startPrice),
    encodeUint(intent.floorPrice),
    encodeUint(intent.deadline),
    encodeUint(intent.intentType),
    encodeUint(intent.nonce),
  ]));
}

function sign(privHex, domSep, sHash) {
  const hash = keccak(Buffer.concat([Buffer.from([0x19, 0x01]), domSep, sHash]));
  const sig  = secp256k1.sign(hash, hexToBytes(privHex), { lowS: true });
  const r    = Buffer.from(sig.r.toString(16).padStart(64, '0'), 'hex');
  const s    = Buffer.from(sig.s.toString(16).padStart(64, '0'), 'hex');
  return '0x' + Buffer.concat([r, s, Buffer.from([sig.recovery + 27])]).toString('hex');
}

// ── Solana pubkey → bytes32 hex ───────────────────────────────────────────────

function solanaPubkeyToBytes32(b58) {
  return '0x' + Buffer.from(bs58.decode(b58)).toString('hex');
}

module.exports = { privToAddress, domainSeparator, structHash, sign, solanaPubkeyToBytes32 };
