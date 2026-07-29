// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

/**
 * @title DecryptedValue
 * @notice Reads the plaintext out of a gateway decryption proof.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `abi.decode`
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `INoxCompute.validateDecryptionProof` returns `decryptionProof[65:]` — the bytes after the
 * 65-byte gateway signature — and the handle gateway encodes the plaintext at the value's NATURAL
 * WIDTH, not ABI-padded to 32 bytes. A `euint16` therefore comes back as **two** bytes and a
 * `euint256` as thirty-two. Measured against `nox-handle-gateway` 0.6.0, not read from a
 * specification: the endpoint's response format is undocumented, as `docs/phase2/PRD-DELTA.md` Q-3
 * already had to record for the readiness endpoint.
 *
 * `abi.decode(raw, (uint256))` reverts outright on a two-byte input, with no reason string — which
 * is exactly how this was found, several transactions into a real epoch. Recorded as delta R-5.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY IT REFUSES RATHER THAN PADS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A zero-length or over-wide payload means the proof is not the shape this contract believes it is.
 * Coercing it — treating empty as zero, or truncating something wider — would turn a malformed
 * proof into a confident number, and every downstream check would then be verifying a value the
 * gateway never attested to.
 */
library DecryptedValue {
    error DecryptedValueEmpty();
    error DecryptedValueTooWide(uint256 length);

    /**
     * @notice Big-endian unsigned read of a 1..32 byte plaintext.
     * @dev Big-endian because that is how the gateway encodes it and how every EVM integer is laid
     *      out; reading it little-endian would produce a plausible number for the wrong value.
     */
    function toUint(bytes memory raw) internal pure returns (uint256 value) {
        uint256 length = raw.length;
        if (length == 0) revert DecryptedValueEmpty();
        if (length > 32) revert DecryptedValueTooWide(length);
        for (uint256 i = 0; i < length; ++i) {
            value = (value << 8) | uint8(raw[i]);
        }
    }
}
