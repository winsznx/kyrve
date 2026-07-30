# Phase 6 security

Phase 5 was the first phase where provider capital moved. Phase 6 is the first where **the same capital
moves between parties** — a claim leaves one holder for another in Cross, and leaves one series for
another in Roll — and the first where Kyrve hands a third party a permanent, irrevocable right to read
something, in Capsule.

That changes the shape of the question again. It is no longer only "can capital be taken, stranded or
double-counted"; it is now also **"can an authority that should not exist be exercised, and can a
disclosure that should be narrow turn out to be wide"**.

Read `docs/phase6/ROLES.md` first. That is the authority model this file is the register against.

---

## 1. Findings register

Severity is the impact if the defence were absent, not the difficulty of reaching it. `FIXED` means the
defence is in the tree with a paired test that fails without it. `ACCEPTED` means the risk is real,
bounded and recorded rather than mitigated. `CARRIED` means it was inherited unchanged and this phase
does not narrow it.

| id | severity | status | finding | disposition |
|---|---|---|---|---|
| U-F1 | **High** | FIXED | An RPC endpoint carrying an Alchemy API key was printed to stdout by an unhandled script error — **twice**, in two different scripts, in the same session. viem's error formatting includes the full request URL, so every script with a top-level `catch (error) { console.error(error) }` was a credential-disclosure path, and there were 36 of them. | `redactUrls` / `safeErrorMessage` in `scripts/lib/env.ts`, applied across 32 scripts. Every thrown error and child-process log is reduced to `scheme://host/***` before it reaches a terminal, a log file or an evidence record. `verify:secrets` was extended to the Phase 6 key names. Commit `f29a49f`. |
| U-F2 | **High** | FIXED | Two capsules issued over the same balance would have been **one handle**. A Nox handle is deterministic in its operands, and a Nox ACL entry is per handle and permanent — so the grant issued to the second auditor would have been a grant to the first, forever, with no `removeViewer`. | `KyrveSeriesToken.issueOwnershipCapsule` mixes the recipient and the issuance sequence into the isolation domain. Proven by attack A3 **and by its paired negative**: replacing the domain with `keccak(msg.sender)` makes the two handles byte-identical and A3 fails. Delta R-6 is why the negative was run rather than assumed. |
| U-F3 | **High** | FIXED | `KyrveSeriesToken.lendSupply` took its recipient as a parameter, so any caller could borrow the aggregate supply handle transiently and publish it irreversibly. Carried from Phase 5 F-1 and restated because Phase 6 added three more contracts that receive transient handles. | One bind-once recipient, no address parameter. Extended in Phase 6 by `isReviewedTransientRecipient`, which answers for exactly the two constructor-pinned tokens; attack A4 asserts both the allowed and the refused answers, including for the books themselves and the vault. |
| U-F4 | Medium | FIXED | A stale `.raw-deployment.json` would have resumed the Phase 6 deployment onto **Phase 5's contracts, whose roles are collapsed onto one address**. Resume is the correct behaviour for an interrupted deployment and is exactly wrong across a role-separation boundary. | The Phase 5 raw state is preserved as `*-superseded-phase5.json` rather than deleted, and `deployments/**/.raw-*.json` is git-ignored so a resume file can never arrive from a checkout. `verify:roles sepolia` reads the deployed registries and asserts the declared holder equals the enforced holder for every role. |
| U-F5 | Medium | FIXED | `kyrve-verify` read `evidence/phase5/` while checking Phase 6 contracts, so four checks failed against a quote the role-separated registry has never heard of. A verification tool that reports FAIL for the wrong reason trains its reader to ignore it, which is the same outcome as not having it. | Epoch, activation and the **deployment record** all resolve through `scripts/lib/layer.ts`. The gate runs it for layer a and layer b separately — a layer B check reading layer A's records would pass without layer B having done anything. |
| U-F6 | Medium | FIXED | One `market.json` was merged into whichever layer was under test, so layer B inherited layer A's Capsule vault and the binding check correctly reported that the vault serves a different series — a FAIL meaning "the wrong contract was attached", not "the binding is broken". | The Capsule vault and Cross book attach only to the series they were deployed over; the Roll book spans both by construction. Layer B reports them `N/A`, which is a third verdict and not a pass. |
| U-F7 | Medium | FIXED | The Sepolia Roll driver reported *"unwinding beyond the published residual is REFUSED"*. It was refused — with `IntentNotOpen(id, 3)`, because the intent had already completed, so the call died at the state guard and never reached the ceiling. A bare `try/catch` around a simulation had asserted a defence that never fired. | Both refusals assert the error **by name** through viem's `ContractFunctionRevertedError`, and the over-unwind attempt runs while the intent is still `ResidualDeclared`. The gate re-checks the decoded names in the evidence record, so a record hand-edited to `true` does not satisfy it. Delta U-10. |
| U-F8 | Low | FIXED | Adopting a live Cross/Roll supply looked like resumption and was not. `SupplyState.Open` is public while the escrow is encrypted, so a drained supply stays Open forever — and netting leaves floor-division **dust**, so even a nonzero escrow may move nothing. Two Sepolia runs netted zero and passed every public check. | The driver always opens fresh, and resumability is proven where it can be measured: the residual is unwound halfway, stopped, and finished from chain state alone. Delta U-9. The contract is unchanged — the privacy property is correct and the operational consequence is the finding. |
| U-F9 | Low | ACCEPTED | The Roll's conversion required opening the source series' redemption **before maturity**, against credit Midnight has already recorded rather than a completed withdrawal. `MaturityRedemptionQueue` is out of scope by owner decision. | Delta U-11. Both operands are read live from chain by the driver, `RedemptionFactorSet(factor, unitsWithdrawn, supplyReference)` makes the derivation reproducible from public data, and the evidence record carries the caveat in `sourceRedemptionOpenedEarly`. The alternative — defaulting to par — was rejected: a roll priced at par by accident moves value in one direction on every netting, silently. |
| U-F10 | Low | ACCEPTED | A capsule's expiry stops it **asserting**, and does not stop its recipient **decrypting**. Nox has no `removeViewer`. | Delta U-3. The vault's `assertsValidAt` is the only thing expiry governs, and the interface must never say "access revoked" for a handle a viewer could already decrypt — `.claude/rules/security.md` names the three permitted phrasings. Closing it is not possible in Nox as pinned; narrowing it is what the snapshot isolation in U-F2 does. |
| U-F11 | Low | ACCEPTED | A Roll is **not atomic**. Escrow, netting and the publicly declared unwind are separate transactions, and no claim of atomicity is made anywhere. | `statusOf` returns the next action so an interrupted roll resumes from chain state; `netRoll` refuses a stale index so a retry cannot net twice; `settleResidual` refuses to pay past the published total even though its proof is replayable by anyone forever. All three are asserted on Sepolia, two of them by decoded error name. |
| U-F12 | **UNVERIFIED** | OPEN | The confidential layer has **no static-analysis coverage**. `crytic-compile` cannot be made to drive solc 0.8.36 in this environment. | Delta U-5, with the exact reproduction. `pnpm verify:phase6` reports this as SKIP and prints `UNVERIFIED BY SLITHER` on every run that reaches a verdict — it can never report PASS, because that would assert coverage that does not exist. The compensating evidence is in §4 and **is not a substitute**. |
| U-F13 | Informational | CARRIED | No gas indistinguishability is claimed, for any Phase 6 path. | Phase 4 carry-over 6, Phase 5 F-11. Capsule, Cross and Roll all touch encrypted state; any statement about their gas would be a new experiment and none is made. |
| U-F14 | Informational | CARRIED | The handle gateway sees plaintext on the way in. | Delta Q-10. Kyrve claims only that no *Kyrve* component receives a decrypted value. Nothing in this phase changes that, and the Verify artefact says so in its own `proofNote`. |
| U-F15 | Informational | CARRIED | Nox gateway proofs are **decryption proofs** — signatures over a released plaintext — and are never described as zero-knowledge proofs. | Stated in the Verify artefact, in the Verify band's footnote, and in `scripts/verify/kyrve-verify.ts`. This is a claim the project declines to make by omission as well as by assertion. |

**No High or Medium finding is open.** U-F12 is the one open item and it is a coverage gap rather than a
defect: it is reported as UNVERIFIED, never as a pass, on every gate run.

---

## 2. What is enforced structurally rather than by review

Each of these is a property the code cannot express a violation of, which is stronger than a check.

**No role can be collapsed onto another.** `KyrveRoleRegistry`'s constructor rejects a zero holder and
every duplicate **pair**, on chain, at declaration — not a modifier that could be forgotten on one
function but a deployment that does not exist if the separation does not hold. 19 Foundry tests cover it,
including all 21 collapsed pairs.

**No role can redirect the residue.** `SeriesResidueAccount`'s destination and `KyrveCrossBook`'s
`FEE_BENEFICIARY` are `immutable`. Attack A2 asserts this over the **compiled ABI** rather than by calling
a setter: a call to a selector that does not exist reverts for a boring reason that proves nothing about
intent, whereas "no state-changing function names a beneficiary" is a fact about the artefact.

**No caller can forge an ownership capsule.** `recordOwnershipCapsule` is contract-gated, not role-gated —
the series token is the only caller that has read a balance handle honestly. Attack A1c asserts `NotToken`
for all seven role holders including the curator.

**No contract outside the reviewed set can be handed a transient handle.** Transient access carries full
persistent-grant power, so `isReviewedTransientRecipient` answers for exactly the two constructor-pinned
tokens. This is where reentrancy actually lives in this system: ERC-7984 over Nox moves handles rather
than calling recipients, so the reachable attack is becoming a contract the book will talk to at all.

**No roll can mint or burn.** Both legs are transfers out of escrow. `Nox.mint` and `Nox.burn` are the only
operations that touch `confidentialTotalSupply` and both produce a **new handle**, so an unchanged supply
handle proves the operation never happened — which is stronger than an equal plaintext. Asserted locally
and on Sepolia.

**No exact-fill enforcement can be collapsed into one contract.** Unchanged from Phase 4 and restated
because Phase 6 added a second settlement path: `isRatified` is `view` and never receives `units`, and
Midnight permits `newConsumed <= offer.maxUnits`.

---

## 3. The authority model, as exercised rather than as declared

`pnpm roles:reconcile` walks 121 receipts from chain and attributes every one to the address that actually
signed it. Separation of duties is a property of what the keys **did**.

Four roles signed nothing across the entire campaign, and the reasons are not interchangeable:

- **residue beneficiary** — a destination, never an authority. Holds no privilege anywhere, and was
  deliberately not swept.
- **auditor** — read-only. Receives capsule snapshots and can sign nothing that changes state.
- **emergency authority** — pause was never invoked, and pause is the only thing it can do. It cannot
  pause a recovery path and cannot seize a confidential balance.
- **operator** — no quote was retired before expiry and no uncommitted funding was recovered.
  `matchOrders` is `onlyKeeper`, so nothing on this campaign was the operator's to sign.

Reporting those four as one line would let a genuine separation failure hide inside an expected silence.

---

## 4. What stands in place of Slither, and what it does not cover

Stated plainly because U-F12 is open.

**What ran:** direct solc 0.8.36 compilation with the pinned settings; the full confidential suite against
the real Nox stack in Docker — no mocked `NoxCompute` anywhere on the path; the Phase 6 attack suite with
every refusal asserted by decoded error name and one paired negative executed to show the suite can fail;
`verify:contract-size` against EIP-170; `verify:gas-cap` against EIP-7825's 16,777,216; `verify:basenames`;
`verify:curve-abi` and `verify:settlement-abi` across the two compiler pins; `verify:privacy-scan`; and
Slither itself over the **settlement** layer, which it can reach — 0 High/Medium findings across the 7
deployed contract paths.

**What that does not give:** automated detection of the classes a static analyser finds cheaply and a test
suite finds only if someone thought of them — uninitialised state, unchecked return values, shadowed
declarations, dangerous strict equalities, reentrancy patterns nobody wrote a fixture for. Nothing above
substitutes for that, and this section does not claim it does.

---

## 5. The boundary, restated for this phase

Phase 6 adds exactly three ways for a value to cross the public/private line, and each says so at the point
of action:

| crossing | when it becomes public | reversible |
|---|---|---|
| a capsule's snapshot handle | never public — granted to **one** recipient, permanently | no |
| a Cross residual | when its owner calls `publishResidual` | **no** |
| a Roll residual | when its holder calls `declareResidual` | **no** |

Everything else in Capsule, Cross and Roll stays encrypted: order sizes, matched quantities, escrow
remainders, provider allocations and every balance on both sides of every transfer. There is no public
order book, and a failed match produces encrypted zero rather than a public reason.

The two residues are public **by their owner's own irreversible choice**, and both interfaces say
"irreversible" at the point of signing rather than afterwards.
