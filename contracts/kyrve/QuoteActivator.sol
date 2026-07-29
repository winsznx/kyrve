// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {WAD} from "midnight/libraries/ConstantsLib.sol";

import {KyrvePublicResultVerifier, VerifiedCurveResult} from "./KyrvePublicResultVerifier.sol";
import {KyrveQuoteId} from "./KyrveQuoteId.sol";
import {KyrveQuoteRegistry} from "./KyrveQuoteRegistry.sol";
import {KyrveSeriesFactory} from "./KyrveSeriesFactory.sol";
import {KyrveSeriesVault} from "./KyrveSeriesVault.sol";
import {QuoteExecution, QuoteProvenance} from "./KyrveQuoteTypes.sol";
import {CurveLeaf, CurveMarketSpec, ICurveUniverseRegistry} from "./interfaces/ICurveLayer.sol";

/**
 * @title QuoteActivator
 * @notice Turns one verified confidential curve result into one executable Midnight offer, and is
 *         the only contract that may (PRD §14.1).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE BOUNDARY CROSSING
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Everything before this contract is private: every mandate, every allocation, every rejected leaf,
 * every capacity, the provider count. Everything after it is public: one market, one rate, one
 * amount, one borrower. Activation IS the crossing, and it happens exactly once per epoch — the
 * registry refuses a second quote for an epoch id it has already seen, forever.
 *
 * What becomes public here, and nothing else:
 *
 *   the selected market index and rate index, the aggregate fill amount, the derived units and
 *   buyer assets, the tick, the approved borrower, the vault, the expiry, and the identity of the
 *   epoch, request, universe, graph root and deployment they came from.
 *
 * What does NOT: the full curve, per-provider allocations, per-leaf capacities, the winning leaf's
 * own capacity, the number of providers behind the fill, and every leaf that lost. None of them is
 * an input to this contract, so none of them can escape through it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE AGGREGATE IS THE FILL. THE LEAF CAPACITY IS NOT.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `aggregateFillAmount` is the SUM OF SUCCESSFULLY RESERVED PROVIDER ALLOCATIONS. Each allocation
 * is floored by `safeDiv`, so it is smaller than the winning leaf's theoretical capacity by
 * deterministic dust — a leaf that could carry 300,000,000 may reserve 299,999,999. This contract
 * uses the published aggregate and never reconstructs a fill from capacity, because capacity is
 * private and because reservations must sum to exactly what the maker owes.
 *
 * The units derivation rounds DOWN for the same reason and in the same direction:
 *
 *     units       = floor(aggregate * WAD / price)
 *     buyerAssets = floor(units * price / WAD)      <=  aggregate
 *
 * so the maker never owes more than providers reserved (PRD invariant 19.2, v1.1 A-8). The residue
 * `aggregate - buyerAssets` is unreserved confidential capacity. It is never rounded back up and
 * never becomes part of the offer.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS DERIVED RATHER THAN SUPPLIED, AND WHY THAT MATTERS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   the borrower   from the epoch's sealed request. Not a parameter, so a keeper cannot redirect a
 *                  quote to an address of their choosing.
 *   the vault      from `KyrveSeriesFactory.seriesIdFor(marketId)`. Not a parameter, so nobody can
 *                  present a contract of their own as the maker — exact-fill enforcement is only as
 *                  strong as the guarantee that the enforcing `onBuy` is Kyrve's.
 *   the price      from `TickLib.tickToPrice`, the pinned Midnight library, and additionally
 *                  checked against the universe's published grid.
 *   the market id  from `IMidnight.touchMarket`, which is Midnight's own derivation, and checked
 *                  against the curated market. `IdLib.toId` is a CREATE2 hash and NOT
 *                  `keccak256(market)`, so both the id and the struct hash are bound.
 *   the fee cap    from the market's live continuous fee, pinning it at activation. A fee raised
 *                  between activation and settlement makes `take` revert rather than silently
 *                  charging the maker more.
 *
 * The keeper supplies only the epoch it is activating, the identity it expects that epoch to have,
 * the proofs, the market struct, the leaf index and a bounded expiry.
 */
contract QuoteActivator {
    using UtilsLib for uint256;

    error BuyerAssetsAboveAggregate(uint256 aggregate, uint256 buyerAssets);
    error FactoryAlreadyBound(address existing);
    error FactoryNotBound();
    error LeafIndexOutOfRange(uint256 leafIndex, uint256 leafCount);
    error LeafPriceMismatch(uint256 registryPrice, uint256 tickPrice);
    error LifetimeOutOfRange(uint256 supplied, uint256 minimum, uint256 maximum);
    error MarketIdMismatch(bytes32 expected, bytes32 actual);
    error MarketStructMismatch(bytes32 expected, bytes32 actual);
    error NegativeTick(int24 tick);
    error NotDeployer(address caller, address expected);
    error NotKeeper(address caller, address expected);
    error PriceBelowSettlementFee(uint256 price, uint256 settlementFee);
    error PriceIsZero(int24 tick);
    error UnitsAreZero(uint256 aggregate, uint256 price);
    error UnselectedLeaf(uint256 leafIndex, uint8 marketIndex, uint8 rateIndex);
    error ValueTooLarge(string field, uint256 value);
    error WrongChain(uint256 expected, uint256 actual);
    error WrongMidnight(address expected, address actual);
    error ZeroAddress(string field);

    event FactoryBound(address indexed factory);
    /**
     * @notice The complete offer, `abi.encode`d, so it can be recovered exactly.
     *
     * WHY AN EVENT AND NOT A RETURN VALUE. `activate` returns the offer, but a caller that
     * simulated the transaction to read it would get an offer built at the SIMULATED block —
     * `start` is `block.timestamp` — and the mined one would differ in exactly the field the hash
     * covers. A borrower would then present an offer no ratifier accepts, for a reason nothing on
     * chain explains.
     *
     * The registry stores only the hash, deliberately: storing the offer would cost several
     * kilobytes of state for a value nobody reads on the hot path. So the offer is emitted once,
     * and any client can recover it, hash it and compare against `QuoteExecution.offerHash` —
     * which is exactly what the ratifier will do.
     */
    event OfferPublished(bytes32 indexed quoteId, bytes offer);
    event QuoteActivated(
        bytes32 indexed quoteId,
        bytes32 indexed epochId,
        address indexed vault,
        bytes32 marketId,
        uint128 exactUnits,
        uint128 expectedBuyerAssets,
        uint256 aggregateFillAmount
    );

    /// @notice A quote must be live long enough for a borrower to act and short enough that a stale
    ///         curve cannot be settled against. Both ends are enforced, not documented.
    uint256 public constant MIN_QUOTE_LIFETIME = 5 minutes;
    uint256 public constant MAX_QUOTE_LIFETIME = 1 days;

    address public immutable MIDNIGHT;
    KyrveQuoteRegistry public immutable REGISTRY;
    KyrvePublicResultVerifier public immutable VERIFIER;
    ICurveUniverseRegistry public immutable UNIVERSES;
    address public immutable RATIFIER;
    /// @notice The only address that may activate. Immutable: activation commits the maker's
    ///         capital, so it is not an open endpoint in this release. See docs/phase4/SECURITY.md.
    address public immutable KEEPER;
    address public immutable DEPLOYER;
    bytes32 public immutable DEPLOYMENT_ID;

    /// @notice Bound once, by the deployer. The factory needs this address at construction, so one
    ///         of the two references cannot be a constructor argument.
    KyrveSeriesFactory public factory;

    constructor(
        KyrveQuoteRegistry registry,
        KyrvePublicResultVerifier verifier,
        ICurveUniverseRegistry universes,
        address ratifier,
        address keeper
    ) {
        require(address(registry) != address(0), ZeroAddress("registry"));
        require(address(verifier) != address(0), ZeroAddress("verifier"));
        require(address(universes) != address(0), ZeroAddress("universes"));
        require(ratifier != address(0), ZeroAddress("ratifier"));
        require(keeper != address(0), ZeroAddress("keeper"));

        REGISTRY = registry;
        MIDNIGHT = registry.MIDNIGHT();
        VERIFIER = verifier;
        UNIVERSES = universes;
        RATIFIER = ratifier;
        KEEPER = keeper;
        DEPLOYER = msg.sender;
        DEPLOYMENT_ID = registry.DEPLOYMENT_ID();
    }

    function bindFactory(KyrveSeriesFactory factory_) external {
        require(msg.sender == DEPLOYER, NotDeployer(msg.sender, DEPLOYER));
        require(address(factory) == address(0), FactoryAlreadyBound(address(factory)));
        require(address(factory_) != address(0), ZeroAddress("factory"));
        factory = factory_;
        emit FactoryBound(address(factory_));
    }

    /// @notice Everything the keeper supplies, grouped so the entry point stays readable and the
    ///         stack stays shallow.
    struct ActivationRequest {
        bytes32 epochId;
        bytes32 expectedGraphRoot;
        bytes32 expectedRequestId;
        bytes32 expectedUniverseId;
        /// @dev The exact `Market` the offer will carry. Checked against the universe's curated
        ///      market by BOTH its Midnight id and its struct hash.
        Market market;
        /// @dev Position of the winning leaf in the universe. A hint: it is checked to carry
        ///      exactly the market and rate indexes the proofs decrypted to, so a wrong hint is
        ///      refused rather than silently accepted.
        uint256 leafIndex;
        /// @dev Seconds from now. Bounded by {MIN_QUOTE_LIFETIME} and {MAX_QUOTE_LIFETIME}.
        uint256 lifetime;
        /// @dev The maker's cap on the continuous fee accruing to new credit, delivered to `onBuy`
        ///      as `pendingFeeIncrease`. Bounded at the principal: a fee exposure above what the
        ///      maker pays is not a quote.
        uint128 maxPendingFee;
    }

    struct Proofs {
        bytes marketProof;
        bytes rateProof;
        bytes floorProof;
        bytes readyProof;
        bytes aggregateProof;
    }

    /**
     * @notice Verifies a finished epoch and activates its one quote.
     * @return quoteId the identifier, which is also `offer.group`.
     * @return offer the exact offer a borrower must present to `Midnight.take`, byte for byte.
     */
    function activate(ActivationRequest calldata request, Proofs calldata proofs)
        external
        returns (bytes32 quoteId, Offer memory offer)
    {
        require(msg.sender == KEEPER, NotKeeper(msg.sender, KEEPER));
        KyrveSeriesFactory boundFactory = factory;
        require(address(boundFactory) != address(0), FactoryNotBound());
        require(
            request.lifetime >= MIN_QUOTE_LIFETIME && request.lifetime <= MAX_QUOTE_LIFETIME,
            LifetimeOutOfRange(request.lifetime, MIN_QUOTE_LIFETIME, MAX_QUOTE_LIFETIME)
        );

        VerifiedCurveResult memory verified = VERIFIER.verifyForActivation(
            request.epochId,
            request.expectedGraphRoot,
            request.expectedRequestId,
            request.expectedUniverseId,
            proofs.marketProof,
            proofs.rateProof,
            proofs.floorProof,
            proofs.readyProof,
            proofs.aggregateProof
        );

        QuoteProvenance memory provenance = _resolveLeaf(request, verified);
        QuoteExecution memory execution = _deriveExecution(request, verified, provenance, boundFactory);

        quoteId = KyrveQuoteId.compute(execution, provenance);
        offer = _buildOffer(request, execution, provenance.tick, quoteId);
        execution.offerHash = keccak256(abi.encode(offer));

        REGISTRY.activate(quoteId, execution, provenance);

        KyrveSeriesVault vault = KyrveSeriesVault(execution.vault);
        if (!IMidnight(MIDNIGHT).isAuthorized(execution.vault, RATIFIER)) {
            vault.authoriseRatifier(RATIFIER, true);
        }
        vault.prepareQuote(quoteId);

        emit OfferPublished(quoteId, abi.encode(offer));
        emit QuoteActivated(
            quoteId,
            request.epochId,
            execution.vault,
            execution.marketId,
            execution.exactUnits,
            execution.expectedBuyerAssets,
            provenance.aggregateFillAmount
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Derivation
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev Binds the decrypted (market, rate) pair to a real leaf of the real universe, and reads
    ///      the tick and price that pair prices at.
    function _resolveLeaf(ActivationRequest calldata request, VerifiedCurveResult memory verified)
        private
        view
        returns (QuoteProvenance memory provenance)
    {
        UNIVERSES.requireActive(verified.universeId);

        uint256 leaves = UNIVERSES.leafCount(verified.universeId);
        require(request.leafIndex < leaves, LeafIndexOutOfRange(request.leafIndex, leaves));

        CurveLeaf memory leaf = UNIVERSES.leafAt(verified.universeId, request.leafIndex);
        require(
            leaf.marketIndex == verified.marketIndex && leaf.rateIndex == verified.rateIndex,
            UnselectedLeaf(request.leafIndex, leaf.marketIndex, leaf.rateIndex)
        );
        require(leaf.tick >= 0, NegativeTick(leaf.tick));

        provenance.epochId = verified.epochId;
        provenance.graphRoot = verified.graphRoot;
        provenance.requestId = verified.requestId;
        provenance.universeId = verified.universeId;
        provenance.deploymentId = DEPLOYMENT_ID;
        provenance.aggregateFillAmount = verified.aggregateFillAmount;
        provenance.tick = leaf.tick;
        provenance.marketIndex = verified.marketIndex;
        provenance.rateIndex = verified.rateIndex;
        require(request.leafIndex <= type(uint16).max, ValueTooLarge("leafIndex", request.leafIndex));
        provenance.leafIndex = uint16(request.leafIndex);
    }

    /// @dev Pins the market, prices the fill and sizes the offer. `touchMarket` is idempotent and
    ///      is Midnight's own id derivation, so the id cannot be asserted by the caller.
    function _deriveExecution(
        ActivationRequest calldata request,
        VerifiedCurveResult memory verified,
        QuoteProvenance memory provenance,
        KyrveSeriesFactory boundFactory
    ) private returns (QuoteExecution memory execution) {
        require(request.market.chainId == block.chainid, WrongChain(block.chainid, request.market.chainId));
        require(request.market.midnight == MIDNIGHT, WrongMidnight(MIDNIGHT, request.market.midnight));

        CurveMarketSpec memory spec = UNIVERSES.marketAt(verified.universeId, verified.marketIndex);
        bytes32 structHash = keccak256(abi.encode(request.market));
        require(structHash == spec.marketStructHash, MarketStructMismatch(spec.marketStructHash, structHash));
        provenance.marketStructHash = structHash;

        bytes32 marketId = IMidnight(MIDNIGHT).touchMarket(request.market);
        require(marketId == spec.marketId, MarketIdMismatch(spec.marketId, marketId));

        uint256 price = TickLib.tickToPrice(uint256(uint24(provenance.tick)));
        require(price != 0, PriceIsZero(provenance.tick));

        CurveLeaf memory leaf = UNIVERSES.leafAt(verified.universeId, provenance.leafIndex);
        require(leaf.priceWad == price, LeafPriceMismatch(leaf.priceWad, price));

        // The live check the universe's static floor cannot make. Midnight computes
        // `sellerPrice = offerPrice - settlementFee` as a CHECKED subtraction, so a fee raised
        // after the universe was frozen would make every `take` revert on underflow (v1.1 A-3).
        uint256 timeToMaturity = UtilsLib.zeroFloorSub(request.market.maturity, block.timestamp);
        uint256 fee = IMidnight(MIDNIGHT).settlementFee(marketId, timeToMaturity);
        require(price >= fee, PriceBelowSettlementFee(price, fee));

        uint256 units = provenance.aggregateFillAmount.mulDivDown(WAD, price);
        require(units != 0, UnitsAreZero(provenance.aggregateFillAmount, price));
        uint256 buyerAssets = units.mulDivDown(price, WAD);
        // Structural, not defensive: floor-then-floor cannot exceed the input. Asserted anyway
        // because it is invariant 19.2 and a silent violation would overdraw the reservation.
        require(
            buyerAssets <= provenance.aggregateFillAmount,
            BuyerAssetsAboveAggregate(provenance.aggregateFillAmount, buyerAssets)
        );
        require(units <= type(uint128).max, ValueTooLarge("units", units));
        require(buyerAssets <= type(uint128).max, ValueTooLarge("buyerAssets", buyerAssets));
        require(uint256(request.maxPendingFee) <= buyerAssets, ValueTooLarge("maxPendingFee", request.maxPendingFee));

        uint256 expiry = block.timestamp + request.lifetime;
        require(expiry <= type(uint40).max, ValueTooLarge("expiry", expiry));

        execution.marketId = marketId;
        // Each of the three narrowing casts below is bounded by the `require` directly above it, so
        // truncation is unreachable. Marked rather than left to the reader, matching Midnight's own
        // convention in `Midnight.take`.
        // forge-lint: disable-next-line(unsafe-typecast)
        execution.exactUnits = uint128(units);
        // forge-lint: disable-next-line(unsafe-typecast)
        execution.expectedBuyerAssets = uint128(buyerAssets);
        execution.maxPendingFee = request.maxPendingFee;
        // forge-lint: disable-next-line(unsafe-typecast)
        execution.expiry = uint40(expiry);
        execution.taker = verified.borrower;
        execution.vault = boundFactory.requireVault(boundFactory.seriesIdFor(marketId));
        execution.ratifier = RATIFIER;
    }

    /**
     * @dev The offer, assembled once. `group` and `callbackData` both carry the quote id: the group
     *      is what Midnight accounts consumption against and what `setConsumed` retires, and the
     *      callback data is what tells `onBuy` which quote it is being asked to settle.
     *
     *      `maxUnits` is the exact fill and `maxAssets` is zero — Midnight requires exactly one of
     *      the two to be non-zero. Setting `maxUnits` to the exact size does NOT by itself enforce
     *      exact fill, because Midnight permits `newConsumed <= offer.maxUnits`; it only bounds the
     *      maximum. Exact fill is `KyrveSeriesVault.onBuy`.
     *
     *      `continuousFeeCap` pins the market's fee as it stands at activation. Raising it before
     *      settlement makes `take` revert `ContinuousFeeAboveOfferCap` rather than charging the
     *      maker more than the quote was priced against.
     */
    function _buildOffer(
        ActivationRequest calldata request,
        QuoteExecution memory execution,
        int24 tick,
        bytes32 quoteId
    ) private view returns (Offer memory) {
        return Offer({
            market: request.market,
            buy: true,
            maker: execution.vault,
            start: block.timestamp,
            expiry: execution.expiry,
            // `tick` was proven non-negative in `_resolveLeaf`, and Midnight's own `Offer.tick` is
            // a `uint256`, so the widening pair below cannot truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            tick: uint256(uint24(tick)),
            group: quoteId,
            callback: execution.vault,
            callbackData: abi.encode(quoteId),
            receiverIfMakerIsSeller: address(0),
            ratifier: execution.ratifier,
            reduceOnly: false,
            maxUnits: execution.exactUnits,
            maxAssets: 0,
            continuousFeeCap: IMidnight(MIDNIGHT).continuousFee(execution.marketId)
        });
    }
}
