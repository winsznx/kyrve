// SPDX-License-Identifier: GPL-2.0-or-later
// Kyrve Day 0 Spike C/D. Not product code.
pragma solidity ^0.8.35;

import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import "encrypted-types/EncryptedTypes.sol";

/// @dev Measures the marginal gas cost of each Nox primitive.
///
/// Every entry point runs the same primitive `n` times. Marginal per-op cost is
/// (gas(n=N) - gas(n=1)) / (N-1), which cancels transaction and calldata overhead.
/// This is the input to Kyrve's operation budget - PRD section 13.7.
contract NoxPrimitiveGas {
    euint256 public a256;
    euint256 public b256;
    euint16 public a16;
    euint16 public b16;
    ebool public flag;

    euint256 public sink256;
    euint16 public sink16;
    ebool public sinkBool;

    function seed(
        externalEuint256 ea,
        bytes calldata pa,
        externalEuint256 eb,
        bytes calldata pb,
        externalEuint16 ea16,
        bytes calldata pa16,
        externalEuint16 eb16,
        bytes calldata pb16
    ) external {
        a256 = Nox.fromExternal(ea, pa);
        b256 = Nox.fromExternal(eb, pb);
        a16 = Nox.fromExternal(ea16, pa16);
        b16 = Nox.fromExternal(eb16, pb16);

        Nox.allowThis(a256);
        Nox.allowThis(b256);
        Nox.allowThis(a16);
        Nox.allowThis(b16);

        flag = Nox.lt(a256, b256);
        Nox.allowThis(flag);
    }

    // ---- unsigned 256 arithmetic ----

    function opAdd(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) r = Nox.add(r, b256);
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSub(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) r = Nox.sub(r, b256);
        Nox.allowThis(r);
        sink256 = r;
    }

    function opMul(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) r = Nox.mul(r, b256);
        Nox.allowThis(r);
        sink256 = r;
    }

    function opDiv(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) r = Nox.div(r, b256);
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSafeAdd(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) {
            (, r) = Nox.safeAdd(r, b256);
        }
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSafeSub(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) {
            (, r) = Nox.safeSub(r, b256);
        }
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSafeMul(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) {
            (, r) = Nox.safeMul(r, b256);
        }
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSafeDiv(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) {
            (, r) = Nox.safeDiv(r, b256);
        }
        Nox.allowThis(r);
        sink256 = r;
    }

    // ---- comparisons ----

    function opLt(uint256 n) external {
        ebool r;
        for (uint256 i = 0; i < n; i++) r = Nox.lt(a256, b256);
        Nox.allowThis(r);
        sinkBool = r;
    }

    function opGe(uint256 n) external {
        ebool r;
        for (uint256 i = 0; i < n; i++) r = Nox.ge(a256, b256);
        Nox.allowThis(r);
        sinkBool = r;
    }

    function opEq(uint256 n) external {
        ebool r;
        for (uint256 i = 0; i < n; i++) r = Nox.eq(a256, b256);
        Nox.allowThis(r);
        sinkBool = r;
    }

    // ---- select ----

    function opSelect256(uint256 n) external {
        euint256 r = a256;
        for (uint256 i = 0; i < n; i++) r = Nox.select(flag, r, b256);
        Nox.allowThis(r);
        sink256 = r;
    }

    function opSelect16(uint256 n) external {
        euint16 r = a16;
        for (uint256 i = 0; i < n; i++) r = Nox.select(flag, r, b16);
        Nox.allowThis(r);
        sink16 = r;
    }

    // ---- 16-bit arithmetic (indicator width) ----

    function opAdd16(uint256 n) external {
        euint16 r = a16;
        for (uint256 i = 0; i < n; i++) r = Nox.add(r, b16);
        Nox.allowThis(r);
        sink16 = r;
    }

    function opMul16(uint256 n) external {
        euint16 r = a16;
        for (uint256 i = 0; i < n; i++) r = Nox.mul(r, b16);
        Nox.allowThis(r);
        sink16 = r;
    }

    // ---- conversions ----

    function opToEuint16(uint256 n) external {
        euint16 r;
        for (uint256 i = 0; i < n; i++) r = Nox.toEuint16(uint16(i + 1));
        Nox.allowThis(r);
        sink16 = r;
    }

    function opToEuint256(uint256 n) external {
        euint256 r;
        for (uint256 i = 0; i < n; i++) r = Nox.toEuint256(i + 1);
        Nox.allowThis(r);
        sink256 = r;
    }

    // ---- ACL ----

    function opAllowThis(uint256 n) external {
        for (uint256 i = 0; i < n; i++) Nox.allowThis(a256);
    }

    function opAllow(uint256 n, address who) external {
        for (uint256 i = 0; i < n; i++) Nox.allow(a256, who);
    }

    function opAllowTransient(uint256 n, address who) external {
        for (uint256 i = 0; i < n; i++) Nox.allowTransient(a256, who);
    }

    /// @dev The composite Kyrve actually needs: an ebool predicate becomes a 0/1
    /// euint16 indicator. Nox has no boolean operations, so this is the only way
    /// to combine predicates - PRD delta D-11.
    function opIndicator(uint256 n) external {
        euint16 r;
        euint16 one = Nox.toEuint16(1);
        euint16 zero = Nox.toEuint16(0);
        for (uint256 i = 0; i < n; i++) r = Nox.select(flag, one, zero);
        Nox.allowThis(r);
        sink16 = r;
    }

    /// @dev A full six-term arithmetised conjunction, the real cost of one
    /// (provider, leaf) eligibility cell.
    function opConjunction6(uint256 n) external {
        euint16 acc;
        for (uint256 i = 0; i < n; i++) {
            euint16 one = Nox.toEuint16(1);
            euint16 zero = Nox.toEuint16(0);
            euint16 p0 = Nox.select(flag, one, zero);
            euint16 p1 = Nox.select(flag, one, zero);
            euint16 p2 = Nox.select(flag, one, zero);
            euint16 p3 = Nox.select(flag, one, zero);
            euint16 p4 = Nox.select(flag, one, zero);
            euint16 p5 = Nox.select(flag, one, zero);
            euint16 m = Nox.mul(p0, p1);
            m = Nox.mul(m, p2);
            m = Nox.mul(m, p3);
            m = Nox.mul(m, p4);
            m = Nox.mul(m, p5);
            acc = m;
        }
        Nox.allowThis(acc);
        sink16 = acc;
    }
}
