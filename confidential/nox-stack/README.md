# Local Nox off-chain stack

**Every key in `dev.env` is local-only Nox development material shipped inside
`@iexec-nox/nox-hardhat-plugin@0.1.0`. None of it controls any value on any public network, and none
of it is a Kyrve key.** It is committed under the exception in `.claude/rules/git.md`, which permits
local Nox test-gateway keys when they are clearly labelled and unusable on a public network. If you
are looking for something that must never be committed, it is not here — see `.env.example`.

## What these files are

Byte-for-byte copies of `offchain-services/` from the pinned plugin, vendored so the stack can be
started and inspected without reaching into `node_modules`. Provenance is asserted by
`pnpm verify:nox-stack`, which fails if either file drifts from what the pinned package ships.

| File | SHA-256 |
|---|---|
| `docker-compose.yml` | `2018a52bb841c6410f8929df48aaa910c2faaade1729eb684400ec9cb8dbd1d2` |
| `dev.env` | `9c604de4d4527b134f7e51cf089833b513ad9d881b9730a230489a43d04fc2f2` |

## The six services

| Service | Image | Role |
|---|---|---|
| `nox-kms` | `iexechub/nox-kms:0.6.0` | holds the key material; decides who may decrypt |
| `nox-handle-gateway` | `iexechub/nox-handle-gateway:0.6.0` | issues input proofs, serves decryption, answers `/v0/public/handles/status` |
| `nox-ingestor` | `iexechub/nox-ingestor:0.6.0` | follows `NoxCompute` events from the chain |
| `nox-runner` | `iexechub/nox-runner:0.6.0` | performs the actual confidential computation off chain |
| `nats` | `nats:2.12-alpine` | queue between ingestor and runner |
| `s3` | `minio/minio` | ciphertext storage |

The stack targets a Hardhat node on the **host** at `host.docker.internal:8545` and expects
`NoxCompute` at `0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685`, which the plugin etches there.

## Running it

`pnpm --filter @kyrve/confidential test` starts and stops the stack around the suite. Nothing else
is required, and nothing persists between runs.

If a run is interrupted, the containers can survive and hold the gateway's host port. The next run
then reads a stale port mapping and points the client at whatever else is listening — usually the
Hardhat node, which answers `400 WebSockets request was expected`. `deployHarness` detects exactly
that and says so. To clear it:

```bash
docker ps --filter name=nox --format '{{.Names}}' | xargs -r docker rm -f
```

## Trust assumption, stated plainly

Confidentiality here rests on the KMS and the gateway. A gateway key compromise is a total
confidentiality compromise — it is the signer for both input proofs and decryption proofs. Locally
that key is public and printed above the fold in `dev.env`, which is precisely why **nothing that
runs against this stack proves anything about production key custody**. It proves the protocol
behaviour: bindings, ACL semantics, refusals and arithmetic.
