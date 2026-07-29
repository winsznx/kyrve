// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {ERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984.sol";
import {ERC7984Base} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984Base.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title KyrveSeriesToken
 * @notice Confidential beneficial ownership of one series' public Midnight credit (PRD §13.13).
 *
 * This is the OFFICIAL pinned implementation — `ERC7984` from `nox-confidential-contracts` version
 * 0.2.2, over the optimised Nox `mint` / `burn` / `transfer` primitives. Kyrve does not reimplement
 * ERC-7984 and does not fork it. Everything below is a narrowing: rules added, nothing loosened.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT ONE UNIT OF THIS TOKEN IS, AND WHAT IT IS NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * One unit is **one loan-token unit of principal a provider actually committed** — their share of
 * the epoch's PUBLISHED AGGREGATE. It is not a Midnight unit and it is not the borrower's assets.
 * Those three numbers are distinct and the Phase 4 Sepolia run measured all of them:
 *
 *   leaf capacity      300,000,000   what the winning (market, rate) COULD carry — private
 *   published aggregate 299,999,999  the sum of successfully reserved allocations — public
 *   units settled      300,000,599   floor(aggregate * WAD / price) — Midnight's denomination
 *   buyer assets paid  299,999,998   floor(units * price / WAD) — what the maker actually paid
 *
 * **Total supply is the published aggregate.** PRD §19.3 states the allocation invariant as *"sum
 * encrypted series allocations = exact Midnight units received"*, and that cannot be taken literally:
 * a unit already carries the discount, so minting 1:1 against units would denominate a claim in
 * redemption face value while the contribution was principal — and invariant 5 (allocations sum to
 * supply) would be false by 600 on this fixture alone. Delta [T-1](../../docs/phase5/PRD-DELTA.md).
 *
 * The unit-to-asset conversion lives in {redemptionFactorWad} instead, as a PUBLIC factor applied
 * identically to every private claim. That is what PRD §19.7 already requires of loss, and yield and
 * loss are the same mechanism in opposite directions — which is exactly why the mint is principal.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * PUBLIC / PRIVATE BOUNDARY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PRIVATE NOW AND AFTER SETTLEMENT
 *     `confidentialBalanceOf(a)`   an encrypted handle. Only `a` may decrypt it — the mint grants
 *                                  `allow(balance, a)` and nothing else. Another wallet asking the
 *                                  gateway is refused, and the suite proves it rather than asserting
 *                                  it. Invariants 6 and 7.
 *     `confidentialTransfer(...)`  amounts never appear in calldata, storage or events.
 *     every redemption entitlement encrypted, granted to its owner only.
 *
 *   PRIVATE NOW, PUBLIC ON A SOLVENCY PUBLICATION — and IRREVERSIBLY
 *     `confidentialTotalSupply()`  encrypted, admin-granted to this contract only, UNTIL
 *                                  {publishAggregateSupply} marks one snapshot publicly decryptable.
 *                                  Nox has no un-publish: no `removeViewer`, no `removeAdmin`, no way
 *                                  to un-set public decryption. What that publication discloses is a
 *                                  number that already equals the epoch's published aggregate, so it
 *                                  adds nothing — but the permanence is real and is stated at the
 *                                  point of action, never as "revocable".
 *
 *   PUBLIC FROM THE MOMENT IT IS SET
 *     `redemptionFactorWad`        derived from public Midnight state. Public by construction and
 *                                  necessarily so: a private factor could not be shown to have been
 *                                  applied consistently, which is invariant 14.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT KYRVE ADDS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **Minting has exactly one caller and no plaintext path.** `mintClaim` is `onlyAllocator` and
 *    takes an `euint256` the allocator holds — never an amount, never an external proof. There is no
 *    function on this contract that mints from a number, so no privileged key can invent a claim.
 *
 * 2. **Bounded operator expiry.** ERC-7984 has NO per-amount allowance — verified against the pinned
 *    interface, there is no `allowance` and no `confidentialAllowance` anywhere. An operator can move
 *    a holder's entire confidential balance until `until` passes, so an unbounded `until` is an
 *    irrevocable gift of the whole claim. {MAX_OPERATOR_WINDOW} refuses anything longer than seven
 *    days and anything already in the past. `until = 0` is always allowed: that is how a holder ends
 *    a grant and it must never be blocked.
 *
 * 3. **Burning has two doors and both are narrow.** `burnAllocation` unwinds a mint that funded a
 *    quote which then failed to settle — allocator only, bounded by what was minted. `redeem` is the
 *    holder's own door and burns only their own balance. Nothing else reduces a balance except a
 *    transfer the holder authorised.
 *
 * 4. **No pause flag exists for anything here, and that is deliberate.**
 *    {KyrveEmergencyController}'s enum has no member for transfer, redemption or burning and must
 *    never gain one (delta Q-6, PRD invariant 20). A provider's claim on capital they already
 *    committed cannot be frozen by an emergency state. The controller is held only so this contract
 *    can be shown to have chosen not to use it.
 */
contract KyrveSeriesToken is ERC7984, KyrveConfidentialBase {
    /// @dev Isolation domains. Declared here rather than shared, for the same reason
    ///      {KyrveCustodyVault} declares its own: nothing that touches `NoxCurveEngine`'s bytecode
    ///      is worth the convenience (delta R-10).
    bytes32 private constant ROLE_SUPPLY_SNAPSHOT = keccak256("kyrve.series.supplySnapshot");
    bytes32 private constant ROLE_ENTITLEMENT = keccak256("kyrve.series.entitlement");
    bytes32 private constant ROLE_ENTITLEMENT_TOTAL = keccak256("kyrve.series.entitlementTotal");

    /// @notice The longest operator grant this token will write. Seven days, because the blast
    ///         radius is the holder's entire claim and there is no per-amount cap to fall back on.
    uint48 public constant MAX_OPERATOR_WINDOW = 7 days;

    uint256 private constant WAD = 1e18;

    /// @notice Identifies the series whose Midnight credit these claims are against.
    bytes32 public immutable SERIES_ID;
    /// @notice The public loan token the series settles and redeems in. Never held by this contract.
    address public immutable LOAN_TOKEN;
    address public immutable DEPLOYER;
    /// @notice The only address that may set or move the public redemption factor.
    address public immutable CURATOR;

    /// @notice The only address that may mint or unwind a claim. Bound once, never again.
    address public allocator;
    /// @notice The only address that may borrow the aggregate supply handle. Bound once, never again.
    address public solvencyVerifier;

    /**
     * @notice The public factor converting one unit of principal claim into redeemable loan assets.
     *
     * @dev `1e18` means par. Above par is yield — the discount Midnight priced into `units`. Below par
     *      is loss (PRD §19.7). Zero means redemption has not opened.
     *
     *      It is PUBLIC because invariant 14 requires it to be shown to have been applied identically
     *      to every private claim, and a private factor cannot be shown to have been applied at all.
     */
    uint256 public redemptionFactorWad;
    uint64 public redemptionOpenedAt;

    /// @notice The supply snapshot published for solvency, or zero. Permanent once set.
    euint256 private _publishedSupply;
    /// @notice Per-holder confidential redemption entitlement, accumulated across redemptions.
    mapping(address holder => euint256) private _entitlement;
    /**
     * @notice Every holder's entitlement, summed. Granted to this contract only, published never.
     *
     * @dev THIS IS AN ENCRYPTED AGGREGATE AND THEREFORE THE Q-5 HAZARD, so it is isolated on every
     *      fold under a domain no holder quantity can share — see {redeem}. It exists because PRD
     *      §19.1 counts *pending confidential redemption claims* on the same side of the solvency
     *      inequality as active claims: a burned claim leaves `totalSupply`, and if the liability it
     *      became were not carried anywhere, redeeming would make the series look MORE solvent the
     *      more it owed. `AggregateSolvencyVerifier` borrows it transiently and publishes only the
     *      verdict.
     */
    euint256 private _totalEntitlement;
    uint32 public redemptionCount;
    /// @notice How much a quote's allocation minted, so an unwind is bounded by it.
    mapping(bytes32 quoteId => uint32) private _mintCount;

    event AllocatorBound(address indexed allocatorAddress);
    event SolvencyVerifierBound(address indexed verifierAddress);
    /// @dev No amount, ever. One shape whatever the encrypted outcome was.
    event ClaimMinted(bytes32 indexed quoteId, address indexed provider);
    event ClaimUnwound(bytes32 indexed quoteId, address indexed provider);
    event RedemptionFactorSet(uint256 factorWad, uint256 unitsWithdrawn, uint256 supplyReference);
    event Redeemed(address indexed holder, uint256 indexed nonce);
    /// @notice IRREVERSIBLE. From this event the snapshot's plaintext is public forever.
    event AggregateSupplyPublished(bytes32 supplyHandle);

    error AllocatorAlreadyBound(address existing);
    error AllocatorNotBound();
    error FactorAboveCap(uint256 supplied, uint256 cap);
    error FactorIsZero();
    error NotAllocator(address caller, address expected);
    error NotCurator(address caller, address expected);
    error NotDeployer(address caller, address expected);
    error NotVerifier(address caller, address expected);
    error VerifierAlreadyBound(address existing);
    error VerifierNotBound();
    error OperatorWindowInThePast(uint48 until, uint48 nowTimestamp);
    error OperatorWindowTooLong(uint48 until, uint48 maximum);
    error RedemptionNotOpen();
    error SupplyAlreadyPublished(bytes32 handle);
    error ZeroAddress(string field);

    /**
     * @dev A factor above this would let a redemption claim more than any plausible discount could
     *      justify, which on a fat-fingered curator call would be indistinguishable from a
     *      correct one. Ten times par is far outside any real fixed-income discount and far inside
     *      the range an arithmetic slip lands in.
     */
    uint256 public constant MAX_REDEMPTION_FACTOR_WAD = 10 * WAD;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        bytes32 seriesId,
        address loanToken,
        address curator,
        KyrveEmergencyController controller
    ) ERC7984(name_, symbol_, contractURI_) KyrveConfidentialBase(controller) {
        if (seriesId == bytes32(0)) revert ZeroAddress("seriesId");
        if (loanToken == address(0)) revert ZeroAddress("loanToken");
        if (curator == address(0)) revert ZeroAddress("curator");
        SERIES_ID = seriesId;
        LOAN_TOKEN = loanToken;
        CURATOR = curator;
        DEPLOYER = msg.sender;
    }

    function bindAllocator(address allocatorAddress) external {
        if (msg.sender != DEPLOYER) revert NotDeployer(msg.sender, DEPLOYER);
        if (allocator != address(0)) revert AllocatorAlreadyBound(allocator);
        if (allocatorAddress == address(0)) revert ZeroAddress("allocator");
        allocator = allocatorAddress;
        emit AllocatorBound(allocatorAddress);
    }

    function bindSolvencyVerifier(address verifierAddress) external {
        if (msg.sender != DEPLOYER) revert NotDeployer(msg.sender, DEPLOYER);
        if (solvencyVerifier != address(0)) revert VerifierAlreadyBound(solvencyVerifier);
        if (verifierAddress == address(0)) revert ZeroAddress("solvencyVerifier");
        solvencyVerifier = verifierAddress;
        emit SolvencyVerifierBound(verifierAddress);
    }

    modifier onlyAllocator() {
        if (allocator == address(0)) revert AllocatorNotBound();
        if (msg.sender != allocator) revert NotAllocator(msg.sender, allocator);
        _;
    }

    /**
     * @notice The token's immutable transient-handle allowlist.
     * @dev Two, each bound once and never again: the allocator, which receives the minted handle for
     *      the transaction in which it records ownership, and the solvency verifier, which borrows the
     *      aggregate supply to compare it against coverage. Transient access carries FULL
     *      persistent-grant power, so this is never a mutable set and never an arbitrary address.
     *      Threat T-J.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        return recipient == allocator || recipient == solvencyVerifier;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Minting — the only path that creates a claim
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mints one provider's confidential claim from the exact handle their lock consumed.
     * @param amount the provider's consumed lock, handle-native. There is no overload that takes a
     *        number, so nothing here can mint against leaf capacity, Midnight units, borrower assets
     *        or a keeper's arithmetic. Invariants 2 and 3.
     * @return minted what `Nox.mint` actually credited — encrypted zero if the mint would have
     *         overflowed the supply, which cannot be branched on and is therefore threaded rather
     *         than checked.
     *
     * @dev THE SUPPLY IDENTITY THIS ESTABLISHES. `Nox.mint` increases `_totalSupply` by exactly what
     *      it credits, so summing the consumed locks into supply makes invariant 1 — total supply
     *      equals the published aggregate actually funded — true by construction rather than by
     *      assertion. It is *also* asserted, from the other side: the custody vault unwrapped the
     *      same sum into public tokens, and that plaintext is public, so the identity is checkable
     *      against a real ERC-20 transfer rather than against an argument.
     *
     *      WHY THE MINTED BALANCE CANNOT ALIAS ANOTHER PROVIDER'S. `Nox.mint`'s operands are
     *      `(balanceTo, amount, totalSupply)` and its balance output is index 1. Two providers minted
     *      in the same quote see different `totalSupply` operands — the first mint changed it — and
     *      different `amount` operands, each an isolated lock handle from a lock-scoped domain. So
     *      even two numerically identical allocations produce two handles with two ACL entries.
     *      Invariant 9, and the negative fixture is a probe rather than a value comparison, because
     *      note R-6 established that the obvious test passes with the defence removed.
     */
    function mintClaim(bytes32 quoteId, address provider, euint256 amount)
        external
        onlyAllocator
        returns (euint256 minted)
    {
        if (provider == address(0)) revert ZeroAddress("provider");
        // One-shot per handle at this contract. Nox supplies no consumption marker of its own
        // (delta Q-2) and an on-chain operation output has no guard at all.
        _consumeHandle(euint256.unwrap(amount));

        minted = _mint(provider, amount);
        _mintCount[quoteId] += 1;

        // `_updateWithOptimizedPrimitives` grants the new BALANCE to the provider. It does not grant
        // the `transferred` handle to anyone, and that handle is what the ownership registry records —
        // so the provider's grant on their own allocated amount is made here, by the only contract
        // that can: `Nox.allow` requires the caller to be an admin, and this contract is one only
        // because it just created the handle.
        Nox.allowThis(minted);
        Nox.allow(minted, provider);

        // `_updateWithOptimizedPrimitives` already granted the new balance to `provider` and to this
        // contract, and nothing else. The allocator needs the minted handle for this transaction only,
        // to record the ownership row.
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(minted, msg.sender);

        emit ClaimMinted(quoteId, provider);
    }

    /**
     * @notice Unwinds a claim minted for a quote that then failed to settle.
     * @dev The other half of invariant 10. A quote can be retired after its funding was consumed, and
     *      in that case the provider's capital is restored by {KyrveCustodyVault.restoreLock} — so the
     *      claim that stood in for it must go, or the provider holds both.
     *
     *      Bounded by what was minted: the burn takes the same handle the mint credited, and
     *      `Nox.burn` returns encrypted zero rather than reverting if the balance no longer covers it
     *      — which happens when the holder transferred the claim onward. That case is a real
     *      shortfall in the unwind, it is recorded as such in delta
     *      [T-4](../../docs/phase5/PRD-DELTA.md), and it is why {SeriesAllocator} refuses to restore
     *      custody for a quote whose claims did not fully unwind.
     */
    function burnAllocation(bytes32 quoteId, address provider, euint256 amount)
        external
        onlyAllocator
        returns (euint256 burned)
    {
        _consumeHandle(euint256.unwrap(amount));
        burned = _burn(provider, amount);

        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(burned, msg.sender);

        emit ClaimUnwound(quoteId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Operators — narrowed, never widened
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Grants `operator` the right to move the caller's ENTIRE confidential claim until
     *         `until`.
     * @dev There is no per-amount allowance in ERC-7984. This grant is all-or-nothing for its whole
     *      lifetime, which is why the window is capped. Pass `until = 0` to end a grant; that path is
     *      never restricted and never pausable.
     */
    function setOperator(address operator, uint48 until) public override {
        if (until != 0) {
            uint48 nowTimestamp = uint48(block.timestamp);
            if (until <= nowTimestamp) revert OperatorWindowInThePast(until, nowTimestamp);
            if (until - nowTimestamp > MAX_OPERATOR_WINDOW) {
                revert OperatorWindowTooLong(until, nowTimestamp + MAX_OPERATOR_WINDOW);
            }
        }
        super.setOperator(operator, until);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Redemption foundation
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Publishes the factor converting one unit of claim into redeemable loan assets.
     *
     * @param unitsWithdrawn the loan assets the series vault actually received from Midnight. PUBLIC:
     *        Midnight's credit ledger is public and Kyrve never claims otherwise.
     * @param supplyReference the aggregate the series minted against. PUBLIC: it is the epoch's
     *        published aggregate.
     *
     * @dev WHY BOTH ARGUMENTS ARE PUBLIC NUMBERS AND THE FACTOR IS COMPUTED HERE. Passing a
     *      pre-computed factor would let a curator supply any ratio and leave nothing on chain
     *      relating it to real state. Passing the two public quantities makes the arithmetic
     *      reproducible from public data by anyone, which is what invariant 14 needs: not "the factor
     *      was applied consistently" but "the factor is this, derived this way, from these numbers".
     *
     *      The factor is applied identically to every claim because it is one public number read by
     *      every {redeem} — there is no per-holder factor, no override and no path that reaches one.
     *      PRD §19.7: no provider receives preferential loss treatment.
     */
    function setRedemptionFactor(uint256 unitsWithdrawn, uint256 supplyReference) external {
        if (msg.sender != CURATOR) revert NotCurator(msg.sender, CURATOR);
        if (supplyReference == 0) revert FactorIsZero();

        uint256 factor = (unitsWithdrawn * WAD) / supplyReference;
        if (factor == 0) revert FactorIsZero();
        if (factor > MAX_REDEMPTION_FACTOR_WAD) revert FactorAboveCap(factor, MAX_REDEMPTION_FACTOR_WAD);

        redemptionFactorWad = factor;
        if (redemptionOpenedAt == 0) redemptionOpenedAt = uint64(block.timestamp);
        emit RedemptionFactorSet(factor, unitsWithdrawn, supplyReference);
    }

    /**
     * @notice Burns the caller's own claim and accrues their confidential redemption entitlement.
     *
     * @dev THE FOUNDATION, AND WHAT IT DELIBERATELY IS NOT. This burns the claim and records what the
     *      holder is owed. It does NOT pay: batching, the Midnight `withdraw` and the confidential
     *      distribution are `MaturityRedemptionQueue` (PRD §13.19) and are out of Phase 5's scope by
     *      owner decision. Recording the entitlement rather than paying it is what keeps the solvency
     *      statement honest across the boundary — burned claims leave supply, and the entitlement
     *      they became is a separate encrypted quantity `AggregateSolvencyVerifier` counts on the
     *      claim side, exactly as PRD §19.1 requires of *pending confidential redemption claims*.
     *
     *      Every arithmetic step threads its success flag. `safeMul` overflowing or `safeDiv`
     *      dividing by zero must produce encrypted zero, never a plausible entitlement — and unsafe
     *      `div` would SATURATE to the type maximum rather than revert, which is why neither appears
     *      here.
     *
     *      A holder whose balance is short burns encrypted zero and accrues encrypted zero. The
     *      transaction succeeds, writes the same slots and emits the same event, because a public
     *      revert would make this a balance oracle.
     */
    function redeem(externalEuint256 encryptedAmount, bytes calldata inputProof, uint256 nonce) external {
        if (redemptionFactorWad == 0) revert RedemptionNotOpen();
        _assertDirectCaller();
        _consumeNonce(nonce);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        euint256 burned = _burn(msg.sender, amount);

        (ebool mulOk, euint256 scaled) = Nox.safeMul(burned, Nox.toEuint256(redemptionFactorWad));
        (ebool divOk, euint256 owed) = Nox.safeDiv(scaled, Nox.toEuint256(WAD));
        euint256 zero = Nox.toEuint256(0);
        euint256 entitled = Nox.select(mulOk, owed, zero);
        entitled = Nox.select(divOk, entitled, zero);

        euint256 accrued = Nox.add(_entitlement[msg.sender], entitled);
        // Isolated before it is granted. Two holders redeeming identical amounts under one factor
        // compute identically, so without this they would be ONE handle with ONE permanent ACL
        // entry — and there is no `removeAdmin`. Invariant 9.
        euint256 isolated = _isolateOwn(accrued, ROLE_ENTITLEMENT, uint256(uint160(msg.sender)));
        _entitlement[msg.sender] = isolated;
        _grantOwnerOnly(isolated, msg.sender);

        // The protocol-wide liability, isolated on EVERY fold rather than only when it is read. The
        // intermediate is written to storage and read back next redemption, so an unisolated one that
        // coincided with a holder's own entitlement would be indistinguishable from it thereafter —
        // and the holder already has a permanent grant on theirs.
        euint256 total = Nox.add(_totalEntitlement, entitled);
        euint256 isolatedTotal = _isolateOwn(total, ROLE_ENTITLEMENT_TOTAL, redemptionCount);
        _totalEntitlement = isolatedTotal;
        redemptionCount += 1;
        // `allowThis` and nothing else. No holder, no verifier, no public mark.
        Nox.allowThis(isolatedTotal);

        emit Redeemed(msg.sender, nonce);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Solvency surface
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Marks the CURRENT aggregate supply publicly decryptable, once, for the proof page.
     *
     * @dev IRREVERSIBLE, AND SAY SO. `allowPublicDecryption` cannot be undone — Nox has no
     *      `removeViewer`, no `removeAdmin` and no un-publish. This function may therefore be called
     *      once per token and reverts thereafter, so a second publication cannot silently pin a later
     *      snapshot that a caller believed was the first.
     *
     *      WHAT IT DISCLOSES. A number that equals the epoch's published aggregate, which
     *      `NoxCurveEngine.publishAggregate` already made public. Individual balances are untouched
     *      and are not recoverable from it — PRD §19.6: *"a snapshot publicly decrypts only aggregate
     *      claim handles"*.
     *
     *      The snapshot is isolated first. The supply handle is `Nox.mint`'s output index 2 and a
     *      balance is index 1, so they are structurally distinct — but a published handle is the one
     *      place where "structurally distinct" is not enough to rely on silently, because publication
     *      is the failure that cannot be undone.
     */
    function publishAggregateSupply() external returns (bytes32 supplyHandle) {
        if (msg.sender != CURATOR) revert NotCurator(msg.sender, CURATOR);
        bytes32 existing = euint256.unwrap(_publishedSupply);
        if (existing != bytes32(0)) revert SupplyAlreadyPublished(existing);

        euint256 snapshot = _isolateOwn(confidentialTotalSupply(), ROLE_SUPPLY_SNAPSHOT, 0);
        _publishedSupply = snapshot;
        Nox.allowThis(snapshot);
        Nox.allowPublicDecryption(snapshot);

        supplyHandle = euint256.unwrap(snapshot);
        emit AggregateSupplyPublished(supplyHandle);
    }

    /// @notice The published supply snapshot, or the undefined handle if none was published.
    function publishedSupply() external view returns (euint256) {
        return _publishedSupply;
    }

    /**
     * @notice The live aggregate supply handle. Admin-granted to this contract only.
     * @dev Named separately from `confidentialTotalSupply()` so a reader of
     *      `AggregateSolvencyVerifier` sees which quantity is being compared, and so the ERC-7984
     *      accessor keeps its standard meaning.
     */
    function confidentialAggregateSupply() external view returns (euint256) {
        return confidentialTotalSupply();
    }

    /// @notice A holder's accrued redemption entitlement. Only the holder holds a grant to decrypt it.
    function confidentialEntitlementOf(address holder) external view returns (euint256) {
        return _entitlement[holder];
    }

    function mintCountOf(bytes32 quoteId) external view returns (uint32) {
        return _mintCount[quoteId];
    }

    /**
     * @notice Hands the bound solvency verifier the aggregate supply handle for one transaction.
     *
     * @dev THE ACCESS CONTROL HERE IS NOT COSMETIC AND AN EARLIER DRAFT GOT IT WRONG. Transient
     *      access carries FULL persistent-grant power: within the transaction the recipient may call
     *      `allowPublicDecryption` and publish the value forever, or `allow` a third party
     *      permanently. A version of this function that took the recipient as a parameter and checked
     *      it against `msg.sender` would therefore let ANY caller publish the aggregate supply
     *      irreversibly. It is restricted to one bound address instead.
     *
     *      It can only ever hand over the TWO AGGREGATES — supply and the summed entitlement. No code
     *      path on this contract reads `_balances` or `_entitlement` for anyone but its owner, so there
     *      is nothing here that could lend a holder's own quantity even to the verifier.
     */
    function lendSupply() external {
        if (solvencyVerifier == address(0)) revert VerifierNotBound();
        if (msg.sender != solvencyVerifier) revert NotVerifier(msg.sender, solvencyVerifier);
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(confidentialTotalSupply(), msg.sender);
        Nox.allowTransient(_totalEntitlement, msg.sender);
    }

    /// @notice Every holder's redemption entitlement, summed. Granted to this contract only.
    function confidentialTotalEntitlement() external view returns (euint256) {
        return _totalEntitlement;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev The `euint256` isolation for a contract with no epoch to anchor to.
     *
     *      `KyrveCurveBase._isolate` threads a per-epoch confidential condition because a 16-bit tag
     *      cannot separate epochs. This token has no epoch and every isolated quantity here is
     *      `euint256`, where the tag carries a full 256-bit domain hash — so `eq(value, value)` is a
     *      sufficient condition and the domain does the separating. The condition's operand is
     *      confidential, so the handle seed is 0 and the result is reproducible off chain, which is
     *      what makes a published handle checkable rather than decorative.
     */
    function _isolateOwn(euint256 value, bytes32 role, uint256 subIndex) private returns (euint256) {
        bytes32 domain = keccak256(abi.encode(block.chainid, address(this), SERIES_ID, role, subIndex));
        return Nox.select(Nox.eq(value, value), value, Nox.toEuint256(uint256(domain)));
    }
}
