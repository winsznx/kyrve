# Nox runtime gate — PASS

Executed 2026-07-28 against the genuine local Nox stack. **Nothing on the Nox path is mocked.**
Raw evidence: [`evidence/day0/nox-runtime/`](../../evidence/day0/nox-runtime/).

Reproduce: `cd spikes/nox && pnpm install && npx hardhat test` (needs Docker running).

## Environment proof

Plugin-managed stack: `nox-kms`, `nox-handle-gateway`, `nox-ingestor`, `nox-runner` all at
**0.6.0**, plus NATS JetStream and MinIO. `NoxCompute` is etched by the plugin at
`0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685` (163 bytes) via `hardhat_setCode`; the handle gateway
is published on a Docker-assigned host port. Local gateway signer
`0xE1a6B1De3AbF04e7FA5355373880350Dc3004D0e` and KMS key
`0x03902284a6bd5198b4a32ef2319fc3ae37ea166aff0320eaa8addb0182ee80381e` are **local-only development
keys shipped inside the plugin** and are unusable on any public network.

Disk before/after the stack: 19 GiB → 38 GiB free after reclaiming Docker build cache (see
[`GATE.md`](GATE.md) §disk).

## 1. End-to-end encrypted computation

Encrypted `add(40, 2)` → real Runner → publicly decrypted **42**. 173,988 gas, handle ready in
597 ms, 97-byte decryption proof. This is the primary proof that the stack genuinely computes.

## 2. Input-proof binding

| Case | Result |
|---|---|
| Correct owner + correct application contract | **ACCEPTED** |
| Proof presented by a different owner | **REJECTED** |
| Proof minted for a different application contract | **REJECTED** (`App mismatch`) |
| Tampered signature | **REJECTED** |
| Truncated proof | **REJECTED** |

Confirms PRD §11.1. **Nuance retained from PRD-DELTA D-2:** the `app` binding is unforgeable
(`appInProof == msg.sender`), but the `owner` binding is an equality check against a caller-supplied
parameter. A contract *could* implement metatransactions by calling `INoxCompute.validateInputProof`
directly. Kyrve's direct-caller rule is therefore a **design policy**, not a cryptographic
impossibility, and must be described as such.

## 3. Primitive execution

All 22 primitives listed in [`OPERATION-BUDGET.md`](OPERATION-BUDGET.md) §1 were **executed**, not
merely inspected: `add sub mul div safeAdd safeSub safeMul safeDiv eq ne lt le gt ge select
toEuint16 toEuint256 allowThis allow allowTransient` plus the indicator and six-term conjunction
composites.

Confirmed absent at runtime and in the full ABI/source surface:
- **no `and` / `or` / `not` / `xor`**
- **no `select(ebool, ebool, ebool)` overload** — booleans cannot be combined directly
- **no batch entry point** — every primitive is a separate external call

Encrypted ÷ encrypted division **exists and executes** (`div`, `safeDiv`), so PRD §11.10 pro-rata
allocation is feasible.

## 4. Async lifecycle

Full path executed: external inputs → `fromExternal` validation → operation graph → inclusion →
handle initially unready → Runner computes → handle ready → authorised decryption → public
decryption → signed proof → on-chain verification.

10 samples: inclusion median 14 ms (p90 18), handle ready median **468 ms** (min 262, p90 492).

There is **no callback into the contract**. Readiness is discovered by polling. The SDK's built-in
retry gives up after ~7 s, so Kyrve must implement its own backoff loop.

## 5. ACL

| Operation | Before → after | Inverse |
|---|---|---|
| `addViewer` | false → true | **none exists** |
| `allowPublicDecryption` | false → true | **none exists** |
| `allowTransient` | scoped to one transaction | `disallowTransient` |

Confirms PRD §11.13 and §18.3. Treat every persistent grant as permanent.

## 6. ERC-7984 series accounting

| Boundary | Verdict |
|---|---|
| `wrap` deposit amount | **PUBLIC** — plain `uint256` in calldata |
| `confidentialBalanceOf` | **PRIVATE** — holder decrypted 1,000,000 locally |
| Operator authority | **TOTAL** — no allowance function exists anywhere in the ABI |
| Operator expiry | **ENFORCED** — `isOperator` false past `until` |
| Provider reservations | encrypted; only a deliberate publish crosses out |
| `unwrap` amount | **PUBLIC and IRREVERSIBLE** — `allowPublicDecryption` on the burn amount; `finalizeUnwrap` writes plaintext into an event |

## 7. Confidential failure

Across eligible, rate-ineligible, underfunded, cap-constrained and market-disabled: identical public
status, identical log count, identical event topic, and only the eligible contribution reached the
encrypted total.

**Not constant-gas.** Four distinct gas values were observed with a 2,974 gas spread (2.1%). Carried
forward as an open residual — see [`THREAT-MODEL.md`](THREAT-MODEL.md) T-1.

## Verdict

**PASS**, with the gas-side channel recorded as an open residual and all latency figures scoped as
local-only.
