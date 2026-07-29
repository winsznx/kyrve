// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/// @dev A permanent, on-chain proof that the host chain executes the Osaka EVM.
///
/// WHY THIS EXISTS. The pinned Morpho Midnight release compiles with `evm_version = "osaka"`. A
/// chain that does not implement Osaka will still ACCEPT the deployment — the bytecode deploys
/// fine — and then behave incorrectly the first time an Osaka opcode is reached. That is the worst
/// possible failure shape: silent at deploy time, wrong at settlement time.
///
/// Day 0 proved Ethereum Sepolia is on Osaka by injecting raw bytecode through `eth_call` with a
/// state override. That proved the chain at a moment in time. This contract makes the same check a
/// permanent deployed artifact, so `pnpm verify:osaka` can re-run it against the live deployment on
/// every CI run rather than trusting a recorded result.
///
/// CLZ is opcode 0x1e (EIP-7939), introduced in Osaka. On a pre-Osaka chain the deployment of this
/// contract itself fails, or `clz` reverts as an undefined opcode — either way, loudly.
contract KyrveOsakaProbe {
    /// @dev Count leading zeros of `x`, via the Osaka CLZ opcode.
    /// `clz(0)` is defined as 256.
    function clz(uint256 x) public pure returns (uint256 result) {
        assembly ("memory-safe") {
            result := clz(x)
        }
    }

    /// @dev Runs the exact three inputs Day 0 verified against live Sepolia, plus the zero case,
    /// and returns true only if all four are mathematically correct.
    ///
    /// A chain that lacked CLZ could not return true here — it would revert first — so this is a
    /// positive proof rather than an absence of evidence.
    function verifyOsaka() external pure returns (bool) {
        return _verify();
    }

    /// @dev Reverts unless the chain executes Osaka. Deployment verification calls this so a
    /// missing fork fails the pipeline rather than producing a `false` someone might ignore.
    function assertOsaka() external pure {
        require(_verify(), OsakaNotAvailable());
    }

    function _verify() internal pure returns (bool) {
        if (clz(1) != 255) return false;
        if (clz(1 << 255) != 0) return false;
        if (clz(1 << 128) != 127) return false;
        if (clz(0) != 256) return false;
        return true;
    }

    error OsakaNotAvailable();

    /// @dev Echoed into the deployment manifest so a recorded verification is tied to a chain.
    function chainId() external view returns (uint256) {
        return block.chainid;
    }
}
