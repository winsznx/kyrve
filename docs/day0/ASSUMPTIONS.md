# Assumptions still in force

Assumptions Kyrve currently relies on that are **not** proven by Day 0 evidence. Each carries the
action that would discharge it.

| # | Assumption | Risk if wrong | Discharge |
|---|---|---|---|
| AS-1 | Testnet Nox latency and gas resemble local | Epoch may exceed the 15-min Workflow ceiling | Run `spikes/nox` suites against Sepolia and Arbitrum Sepolia |
| AS-2 | The two Nox testnets behave equivalently | Portability breaks silently | They already run different contract versions and KMS keys — test both, assume neither |
| AS-3 | Gas variation across confidential branches is calldata/storage, not predicate-driven | Side channel leaks private outcomes | Constant-gas review (THREAT-MODEL T-1) |
| AS-4 | D1 + R2 sustain realistic ingestion | Indexer stalls; API contends | Load test: reorg replacement, batch ingest under concurrent reads, index rebuild |
| AS-5 | Concurrent epochs do not interfere | Cross-epoch corruption | Two keepers, same series, overlapping epochs |
| AS-6 | Nox packages will not break before submission | Rework | `packages/nox` wrapper (PRD v1.1 A-15); pin exactly; re-verify on bump |
| AS-7 | `POST /v0/public/handles/status` stays available | Readiness polling breaks | Wrap it; treat as unstable; have a fallback |
| AS-8 | The pinned public RPC keeps serving `eth_getLogs` | Indexer degrades silently | Monitor for policy errors; make range a config value |
| AS-9 | Sepolia stays on Osaka | Replica undeployable | CLZ probe in `verify:deployment` |
| AS-10 | Morpho will grant, or non-production use suffices | Submission/hosting exposure | Contact Morpho Association |
| AS-11 | 24M gas is a safe transaction ceiling on Sepolia | Transactions fail at the cap | Confirm against live Sepolia block gas limits before Phase 1 deployment |
