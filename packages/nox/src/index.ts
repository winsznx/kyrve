/**
 * @kyrve/nox — the ONLY module in the workspace permitted to depend on iExec Nox.
 *
 * `scripts/verify/import-boundary.ts` fails the build if any other package, worker or app imports
 * `@iexec-nox/*` or `encrypted-types` directly. That check is the enforcement half of PRD v1.1
 * A-15; this package is the other half.
 */

export {
  assertMayReceiveTransient,
  assertReversible,
  canRevoke,
  describeSnapshotDisclosure,
  endOfAccessWording,
  GRANT_SEMANTICS,
  type Grant,
  type GrantKind,
  type GrantSemantics,
  IrreversibleGrantError,
  isReversible,
  type SnapshotDisclosure,
  TransientEscalationError,
  type TransientRecipientPolicy,
} from "./acl.js";
export {
  CONFIDENTIAL_STATE_COPY,
  type ConfidentialState,
  confidentialStateOf,
  type HandleAcl,
  readAcl,
} from "./acl-chain.js";
export {
  COLLATERAL_FAMILY_SLOTS,
  type DisclosurePreview,
  type EncodedMandate,
  type EncodedRequest,
  encryptMandate,
  encryptRequest,
  KYRVE_SCHEMA_VERSION,
  MANDATE_HANDLE_COUNT,
  MARKET_SLOTS,
  MATURITY_BUCKET_SLOTS,
  type MandatePlaintext,
  mandateDisclosure,
  mandateFields,
  REQUEST_HANDLE_COUNT,
  type RequestPlaintext,
  requestDisclosure,
  requestFields,
} from "./books.js";
export {
  createHandleClient,
  type EncryptedInput,
  type KyrveHandleClient,
  NotAuthorisedToDecryptError,
  NoxClientError,
} from "./client.js";
export {
  acceptDecryption,
  type DecryptionProof,
  DecryptionProofError,
  describePublication,
  type PublicationIntent,
  parseProof,
  type VerifiedDecryption,
  verificationCalldata,
} from "./decryption.js";

export {
  assertHandleMatchesGraph,
  chunkId,
  EPOCH_STAGES,
  type EpochStage,
  encodeOperation,
  expectedAggregateHandle,
  GraphError,
  graphRoot,
  HandleBindingError,
  inputCommitment,
  type OperationDescriptor,
  requestBinding,
  stageId,
  universeBinding,
} from "./graph.js";

export {
  ABSENT_OPERATIONS,
  assertSupported,
  CELL_GAS,
  capacityReduction,
  comparison,
  leafWinnerReduction,
  multiply,
  type OperationPlan,
  type PlannedOp,
  PRIMITIVES,
  type PrimitiveOp,
  predicateIndicator,
  proportionalAllocation,
  providerCountReduction,
  safeSubtract,
  selectAsMask,
  UnsupportedOperationError,
} from "./plan.js";

export {
  backoffSchedule,
  classifyFailure,
  DEFAULT_POLL_POLICY,
  fetchTransport,
  HandleNotReadyError,
  type HandleState,
  type HandleStatus,
  NoxGatewayError,
  type PollPolicy,
  parseHandleState,
  type StatusTransport,
  statusUrl,
  type WaitOptions,
  waitForHandle,
} from "./runtime.js";
export {
  type Address,
  assertFitsType,
  ENCRYPTED_TYPES,
  type EncryptedType,
  EXTERNAL_TYPES,
  type Handle,
  type Hex,
  isEncryptedType,
  type NoxNetwork,
  NoxTypeError,
  PROOF_EXPIRY_SECONDS,
  TYPE_BOUNDS,
} from "./types.js";
