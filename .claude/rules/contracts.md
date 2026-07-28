---
description: Solidity conventions for Kyrve contracts
globs: ["contracts/**", "**/*.sol"]
---

# Contracts

- solc **0.8.34**, `evm_version = "osaka"`, `via_ir`, optimizer on, `bytecode_hash = "none"` —
  matching the pinned Midnight release so bytecode comparison stays meaningful.
- Every Kyrve contract carries `SPDX-License-Identifier: GPL-2.0-or-later`. Kyrve contracts import
  GPL-2.0-or-later Midnight interfaces and libraries; see `docs/day0/LICENSE-MATRIX.md`.
- Custom errors, never revert strings. Include the offending values:
  `error WrongUnits(uint256 expected, uint256 actual)`.
- Checks, then effects, then interactions. Mark a quote consumed **before** any external call.
- Every callback validates `msg.sender` against the pinned Midnight address. Every privileged
  function validates its caller.
- No upgradeability and no arbitrary-call surface on the ratifier or the series vault.
- Immutables for pinned addresses. Never read a protocol address from mutable storage on a hot path.
- No `unchecked` unless a comment proves the bound.
- Never suppress a compiler error or warning to get a build through.
- `partial` is a reserved keyword in 0.8.34. Name things accordingly.
- Public/private boundaries get a comment naming what becomes public and when.
