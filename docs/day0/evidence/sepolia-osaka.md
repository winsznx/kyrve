# Evidence: Ethereum Sepolia executes the Osaka EVM fork

Retrieved: 2026-07-28T20:57:37Z
RPC: https://ethereum-sepolia-rpc.publicnode.com (keyless public endpoint)
Chain head: 0xad8236
Client: Geth/v1.17.1-stable-16783c16/linux-amd64/go1.25.7

## Why this matters
vendor/midnight foundry.toml pins evm_version = "osaka". If Sepolia were not on Osaka,
the pinned Morpho Midnight release could not be deployed unmodified and PRD section 3.1 would fail.

## Method
eth_call with state override injects raw bytecode at a scratch address and executes it against
the live Sepolia head. CLZ is opcode 0x1e (EIP-7939), introduced in Osaka.

## Results
| test | bytecode | expected | actual |
|---|---|---|---|
| CLZ(1) | `0x60011e5f5260205ff3` | 255 (0x…ff) | `0x00000000000000000000000000000000000000000000000000000000000000ff` |
| CLZ(1<<255) | `0x600160ff1b1e5f5260205ff3` | 0 | `0x0000000000000000000000000000000000000000000000000000000000000000` |
| CLZ(1<<128) | `0x600160801b1e5f5260205ff3` | 127 (0x…7f) | `0x000000000000000000000000000000000000000000000000000000000000007f` |
| undefined opcode 0x0c (control) | `0x60010c5f5260205ff3` | must ERROR | `invalid opcode: opcode 0xc not defined` |

## Verdict

**PASS.** CLZ returns mathematically correct results for three distinct inputs, while the
control proves the endpoint does reject undefined opcodes ("invalid opcode: opcode 0xc not defined").
Therefore Sepolia's EVM implements Osaka. Corroborating signals from `eth_config`:
P256VERIFY precompile present at 0x0000000000000000000000000000000000000100 (EIP-7951, Osaka),
blobSchedule target=14 max=21, next fork = null.
