// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {
    CURVE_COLLATERAL_FAMILY_SLOTS,
    CURVE_MATURITY_BUCKET_SLOTS,
    CURVE_MATURITY_RANK_STRIDE,
    CURVE_MAX_CELLS_PER_TRANSACTION,
    CURVE_MAX_LEAVES,
    CURVE_MAX_MARKETS,
    CURVE_MAX_PROVIDERS,
    CURVE_MAX_PUBLIC_PRIORITY,
    CURVE_MAX_RATES_PER_MARKET,
    CURVE_RANK_CEILING,
    CURVE_RATE_RANK_STRIDE,
    CURVE_RECOMMENDED_CELLS_PER_TRANSACTION
} from "./CurveConstants.sol";

/**
 * @title CurveUniverseRegistry
 * @notice The public half of a confidential quote (PRD §9.1, §13.7).
 *
 * A universe is every market and every rate the curve engine may quote at, published in full and
 * hashed. It contains no ciphertext and imports no Nox primitive, and it lives in the confidential
 * compilation unit only because `NoxCurveEngine` links against it and that unit is pinned at solc
 * 0.8.36 (delta Q-1).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE GRID IS PUBLIC, WHICH LOOKS LIKE A CONCESSION AND IS NOT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Publishing the rate grid is what makes the whole universe executable. One eligibility cell
 * collapses to a single encrypted comparison — a PUBLIC leaf rate index against the provider's
 * ENCRYPTED minimum — instead of an encrypted-to-encrypted comparison plus an indicator conversion
 * plus a multiply. That is the difference between 76,402 gas per cell and 146,865, and between a
 * 16 x 128 universe costing ~226M gas and one costing ~380M (docs/day0/OPERATION-BUDGET.md §2).
 *
 * Nothing private is disclosed by it. The grid says which rates MAY be quoted. It says nothing
 * about which provider will lend, at what rate, in what size, or whether any of them will at all.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC FROM CREATION   every field in this contract, without exception — market identifiers,
 *                          maturities, collateral families, the whole tick grid, the privacy floor,
 *                          the provider ceiling and the stage budgets.
 *   PRIVATE               nothing. There is no encrypted state here and no handle is stored.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * IMMUTABILITY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A universe is assembled as a draft and then activated. Activation computes `universeHash` over
 * every field and sets a flag that no function clears — there is no deactivate, no edit and no
 * upgrade path. A quote binds to the hash, so a universe that could change after a mandate was
 * written against it would let the curator move the goalposts under a sealed epoch.
 */
contract CurveUniverseRegistry {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Declared limits — PRD §9.1, and the shape every fixed-length encrypted submission assumes
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice PRD §9.1. Also the width of one accumulate chunk (OPERATION-BUDGET §4).
    uint256 public constant MAX_PROVIDERS = CURVE_MAX_PROVIDERS;
    /// @notice Matches `EncryptedMandateBook.MARKET_SLOTS`; a mandate has exactly this many slots.
    uint256 public constant MAX_MARKETS = CURVE_MAX_MARKETS;
    uint256 public constant MAX_RATES_PER_MARKET = CURVE_MAX_RATES_PER_MARKET;
    uint256 public constant MAX_LEAVES = CURVE_MAX_LEAVES;
    /// @notice Matches `EncryptedMandateBook.COLLATERAL_FAMILY_SLOTS` / `MATURITY_BUCKET_SLOTS`.
    uint256 public constant COLLATERAL_FAMILY_SLOTS = CURVE_COLLATERAL_FAMILY_SLOTS;
    uint256 public constant MATURITY_BUCKET_SLOTS = CURVE_MATURITY_BUCKET_SLOTS;
    /// @notice Three bits in `publicLeafRank`'s tail. See {publicLeafRank}.
    uint16 public constant MAX_PUBLIC_PRIORITY = CURVE_MAX_PUBLIC_PRIORITY;

    /**
     * @notice The smallest privacy floor a universe may declare.
     * @dev A floor of 1 is not a privacy floor: a leaf filled by exactly one provider tells that
     *      provider the entire aggregate is theirs, and tells the borrower they faced one
     *      counterparty. PRD §8.3 requires at least two. The floor is public; the actual provider
     *      count for a leaf never is.
     */
    uint16 public constant MIN_PRIVACY_FLOOR = 2;

    /// @notice Measured ceiling from docs/day0/OPERATION-BUDGET.md §4, binding on implementation.
    uint256 public constant MAX_CELLS_PER_TRANSACTION = CURVE_MAX_CELLS_PER_TRANSACTION;
    uint256 public constant RECOMMENDED_CELLS_PER_TRANSACTION = CURVE_RECOMMENDED_CELLS_PER_TRANSACTION;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice One Midnight market this universe may quote into.
     * @dev `marketStructHash` is `keccak256(abi.encode(Market))` for the exact struct the settlement
     *      path will present to Midnight, and `marketId` is Midnight's own `IdLib.toId` of it. Both
     *      are recorded so a later phase cannot substitute a different market that happens to share
     *      an id derivation — `Market` embeds `chainId` and the Midnight address, so binding to it
     *      carries native chain and deployment replay protection.
     */
    struct MarketSpec {
        bytes32 marketId;
        bytes32 marketStructHash;
        uint64 maturity;
        /// @dev Index into a mandate's `collateralFamilyCaps[4]`. Bounded at construction.
        uint16 collateralFamily;
        /// @dev Index into a mandate's `maturityBucketCaps[4]`, and the value the borrower's
        ///      encrypted maturity preference is compared against.
        uint16 maturityBucket;
        uint32 tickSpacing;
        /// @dev A grid tick priced below this makes Midnight's `take` revert on fee underflow
        ///      (delta A-3). Enforced on every tick at activation, not documented and hoped for.
        uint256 settlementFeeFloorWad;
        /// @dev Selection criterion 5. Lower sorts first. Public, deterministic, set at creation.
        uint16 publicPriority;
    }

    /// @notice One (market, rate) cell of the universe. `leafIndex` is its position in policy order.
    struct Leaf {
        uint8 marketIndex;
        uint8 rateIndex;
        int24 tick;
        uint256 priceWad;
    }

    struct UniverseHeader {
        address curator;
        uint16 maxProviders;
        uint16 privacyFloor;
        /// @dev The smallest amount that counts as "capacity available" for the three cap
        ///      predicates. Public: it is a universe parameter, not a provider's business.
        uint256 minTicketAssets;
        uint16 marketCount;
        uint16 leafCount;
        uint32 cellsPerChunk;
        bool active;
        uint64 createdAt;
        uint64 activatedAt;
        bytes32 universeHash;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The only address permitted to assemble a universe. Immutable: a mutable curator is
    ///         a mutable universe by another name.
    address public immutable curator;

    mapping(bytes32 universeId => UniverseHeader) private _headers;
    mapping(bytes32 universeId => MarketSpec[]) private _markets;
    mapping(bytes32 universeId => Leaf[]) private _leaves;
    /// @notice Per-market published grid hash, matching `docs/phase1/RATE-GRIDS.md`.
    mapping(bytes32 universeId => mapping(uint256 marketIndex => bytes32)) public gridHash;

    event UniverseCreated(bytes32 indexed universeId, address indexed curator, uint16 privacyFloor);
    event MarketAdded(bytes32 indexed universeId, uint16 indexed marketIndex, bytes32 marketId, uint16 rateCount);
    event UniverseActivated(bytes32 indexed universeId, bytes32 universeHash, uint16 marketCount, uint16 leafCount);

    error NotCurator(address caller, address expected);
    error UniverseExists(bytes32 universeId);
    error UnknownUniverse(bytes32 universeId);
    error UniverseIsActive(bytes32 universeId);
    error UniverseNotActive(bytes32 universeId);
    error TooManyProviders(uint16 supplied, uint256 maximum);
    error TooManyMarkets(uint256 supplied, uint256 maximum);
    error TooManyRates(uint256 supplied, uint256 maximum);
    error TooManyLeaves(uint256 supplied, uint256 maximum);
    error PrivacyFloorTooLow(uint16 supplied, uint16 minimum);
    error PrivacyFloorAboveProviders(uint16 floorValue, uint16 maxProviders);
    error EmptyUniverse(bytes32 universeId);
    error EmptyGrid(uint16 marketIndex);
    error GridLengthMismatch(uint256 ticks, uint256 prices);
    error TickNotOnSpacing(uint16 marketIndex, uint16 rateIndex, int24 tick, uint32 spacing);
    error RateGridNotDescending(uint16 marketIndex, uint16 rateIndex, int24 previousTick, int24 tick);
    error PriceGridNotDescending(uint16 marketIndex, uint16 rateIndex, uint256 previousPrice, uint256 price);
    error PriceBelowSettlementFee(uint16 marketIndex, uint16 rateIndex, uint256 priceWad, uint256 feeFloorWad);
    error PriceAbovePar(uint16 marketIndex, uint16 rateIndex, uint256 priceWad);
    error CollateralFamilyOutOfRange(uint16 supplied, uint256 slots);
    error MaturityBucketOutOfRange(uint16 supplied, uint256 slots);
    error MaturityInThePast(uint16 marketIndex, uint64 maturity, uint64 nowTimestamp);
    error TickSpacingIsZero(uint16 marketIndex);
    error MarketIdIsZero(uint16 marketIndex);
    error DuplicateMarketId(uint16 marketIndex, bytes32 marketId);
    error ChunkOutOfBudget(uint32 supplied, uint256 maximum);
    error MinTicketIsZero();
    error PublicPriorityOutOfRange(uint16 supplied, uint16 maximum);

    /// @dev The WAD Midnight prices against. `tickToPrice` is capped at par, so no grid point may
    ///      exceed it — a price above par would mean a maker funding more than face value.
    uint256 private constant WAD = 1e18;

    constructor(address curator_) {
        if (curator_ == address(0)) revert NotCurator(address(0), address(0));
        curator = curator_;
    }

    modifier onlyCurator() {
        if (msg.sender != curator) revert NotCurator(msg.sender, curator);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Assembly
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Deterministic, chain- and deployment-bound identifier for a universe.
    function universeIdFor(string calldata label) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), label));
    }

    /**
     * @notice Opens a draft universe. Nothing may be quoted against it until {activateUniverse}.
     * @param maxProviders the provider ceiling. Also the accumulate chunk's provider width.
     * @param privacyFloor the minimum number of eligible providers a leaf needs before it may be
     *        selected. A leaf below the floor contributes encrypted zero and produces no public
     *        reason (PRD invariant 1) — this value is the only thing about the count that is public.
     * @param minTicketAssets the threshold the three capacity predicates test against.
     * @param cellsPerChunk the accumulate chunk width the keeper will use, checked against the
     *        measured ceiling so a universe cannot be created that no transaction can process.
     */
    function createUniverse(
        string calldata label,
        uint16 maxProviders,
        uint16 privacyFloor,
        uint256 minTicketAssets,
        uint32 cellsPerChunk
    ) external onlyCurator returns (bytes32 universeId) {
        universeId = universeIdFor(label);
        if (_headers[universeId].curator != address(0)) revert UniverseExists(universeId);

        if (maxProviders == 0 || maxProviders > MAX_PROVIDERS) {
            revert TooManyProviders(maxProviders, MAX_PROVIDERS);
        }
        if (privacyFloor < MIN_PRIVACY_FLOOR) revert PrivacyFloorTooLow(privacyFloor, MIN_PRIVACY_FLOOR);
        if (privacyFloor > maxProviders) revert PrivacyFloorAboveProviders(privacyFloor, maxProviders);
        if (minTicketAssets == 0) revert MinTicketIsZero();
        if (cellsPerChunk == 0 || cellsPerChunk > MAX_CELLS_PER_TRANSACTION) {
            revert ChunkOutOfBudget(cellsPerChunk, MAX_CELLS_PER_TRANSACTION);
        }

        _headers[universeId] = UniverseHeader({
            curator: msg.sender,
            maxProviders: maxProviders,
            privacyFloor: privacyFloor,
            minTicketAssets: minTicketAssets,
            marketCount: 0,
            leafCount: 0,
            cellsPerChunk: cellsPerChunk,
            active: false,
            createdAt: uint64(block.timestamp),
            activatedAt: 0,
            universeHash: bytes32(0)
        });

        emit UniverseCreated(universeId, msg.sender, privacyFloor);
    }

    /**
     * @notice Appends one market and its complete rate grid.
     * @param ticks the Midnight ticks, ordered so that index 0 is the HIGHEST tick.
     * @param pricesWad `tickToPrice(tick)` for each tick, supplied rather than derived because
     *        Midnight's price curve is not expressible here, and checked for the two properties
     *        that matter: strictly descending, and at or above the settlement-fee floor.
     *
     * @dev THE ORDERING RULE, WHICH IS THE OPPOSITE OF THE OBVIOUS ONE. Midnight's `tickToPrice`
     *      is monotonically non-decreasing and capped at WAD, so a HIGHER tick is a HIGHER price is
     *      CHEAPER borrowing (`.claude/rules/morpho-midnight.md`, proven in Phase 0). Rate index 0
     *      is therefore the cheapest borrowing and the highest tick, matching
     *      `docs/phase1/RATE-GRIDS.md`. Getting this backwards would invert the selection policy
     *      while every test still passed, so it is enforced here rather than documented.
     */
    function addMarket(
        bytes32 universeId,
        MarketSpec calldata spec,
        int24[] calldata ticks,
        uint256[] calldata pricesWad
    ) external onlyCurator returns (uint16 marketIndex) {
        UniverseHeader storage header = _requireDraft(universeId);

        if (_markets[universeId].length >= MAX_MARKETS) {
            revert TooManyMarkets(_markets[universeId].length + 1, MAX_MARKETS);
        }
        marketIndex = uint16(_markets[universeId].length);

        if (ticks.length == 0) revert EmptyGrid(marketIndex);
        if (ticks.length > MAX_RATES_PER_MARKET) revert TooManyRates(ticks.length, MAX_RATES_PER_MARKET);
        if (ticks.length != pricesWad.length) revert GridLengthMismatch(ticks.length, pricesWad.length);
        if (spec.marketId == bytes32(0)) revert MarketIdIsZero(marketIndex);
        if (spec.tickSpacing == 0) revert TickSpacingIsZero(marketIndex);
        if (spec.collateralFamily >= COLLATERAL_FAMILY_SLOTS) {
            revert CollateralFamilyOutOfRange(spec.collateralFamily, COLLATERAL_FAMILY_SLOTS);
        }
        if (spec.maturityBucket >= MATURITY_BUCKET_SLOTS) {
            revert MaturityBucketOutOfRange(spec.maturityBucket, MATURITY_BUCKET_SLOTS);
        }
        if (spec.maturity <= block.timestamp) {
            revert MaturityInThePast(marketIndex, spec.maturity, uint64(block.timestamp));
        }
        // The tail of `publicLeafRank` is exactly 7 bits: 3 for priority, 4 for the market index.
        // A priority above 7 would silently wrap into the market-index bits and reorder the whole
        // universe while every other check still passed.
        if (spec.publicPriority > MAX_PUBLIC_PRIORITY) {
            revert PublicPriorityOutOfRange(spec.publicPriority, MAX_PUBLIC_PRIORITY);
        }

        MarketSpec[] storage markets = _markets[universeId];
        for (uint256 i = 0; i < markets.length; ++i) {
            if (markets[i].marketId == spec.marketId) revert DuplicateMarketId(marketIndex, spec.marketId);
        }

        if (_leaves[universeId].length + ticks.length > MAX_LEAVES) {
            revert TooManyLeaves(_leaves[universeId].length + ticks.length, MAX_LEAVES);
        }

        _validateGrid(marketIndex, spec, ticks, pricesWad);

        markets.push(spec);
        Leaf[] storage leaves = _leaves[universeId];
        for (uint256 r = 0; r < ticks.length; ++r) {
            leaves.push(
                Leaf({marketIndex: uint8(marketIndex), rateIndex: uint8(r), tick: ticks[r], priceWad: pricesWad[r]})
            );
        }

        header.marketCount = uint16(markets.length);
        header.leafCount = uint16(leaves.length);
        gridHash[universeId][marketIndex] = keccak256(abi.encode(spec.marketId, ticks, pricesWad));

        emit MarketAdded(universeId, marketIndex, spec.marketId, uint16(ticks.length));
    }

    /**
     * @notice Freezes the universe and computes the hash every quote binds to.
     * @dev Terminal. There is no path back to draft, and the hash covers every field including the
     *      chain id and this contract's address, so a universe assembled on one deployment can
     *      never be presented as one from another.
     */
    function activateUniverse(bytes32 universeId) external onlyCurator returns (bytes32 universeHash) {
        UniverseHeader storage header = _requireDraft(universeId);
        MarketSpec[] storage markets = _markets[universeId];
        Leaf[] storage leaves = _leaves[universeId];
        if (markets.length == 0 || leaves.length == 0) revert EmptyUniverse(universeId);

        bytes32[] memory grids = new bytes32[](markets.length);
        for (uint256 i = 0; i < markets.length; ++i) {
            grids[i] = gridHash[universeId][i];
        }

        universeHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                universeId,
                header.maxProviders,
                header.privacyFloor,
                header.minTicketAssets,
                header.cellsPerChunk,
                markets,
                leaves,
                grids
            )
        );

        header.active = true;
        header.activatedAt = uint64(block.timestamp);
        header.universeHash = universeHash;

        emit UniverseActivated(universeId, universeHash, header.marketCount, header.leafCount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views. All public by construction.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function headerOf(bytes32 universeId) external view returns (UniverseHeader memory) {
        return _requireKnown(universeId);
    }

    function marketAt(bytes32 universeId, uint256 marketIndex) external view returns (MarketSpec memory) {
        _requireKnown(universeId);
        return _markets[universeId][marketIndex];
    }

    function marketsOf(bytes32 universeId) external view returns (MarketSpec[] memory) {
        _requireKnown(universeId);
        return _markets[universeId];
    }

    function leafAt(bytes32 universeId, uint256 leafIndex) external view returns (Leaf memory) {
        _requireKnown(universeId);
        return _leaves[universeId][leafIndex];
    }

    function leavesOf(bytes32 universeId) external view returns (Leaf[] memory) {
        _requireKnown(universeId);
        return _leaves[universeId];
    }

    function leafCount(bytes32 universeId) external view returns (uint256) {
        return _leaves[universeId].length;
    }

    /// @notice Reverts unless the universe exists and is frozen. The check every consumer makes.
    function requireActive(bytes32 universeId) external view returns (bytes32 universeHash) {
        UniverseHeader storage header = _requireKnown(universeId);
        if (!header.active) revert UniverseNotActive(universeId);
        return header.universeHash;
    }

    function isActive(bytes32 universeId) external view returns (bool) {
        return _headers[universeId].active;
    }

    /**
     * @notice The public rank of a leaf under the deterministic selection policy.
     * @dev Criteria 1, 5, 6 and 7 of PRD §9.3 as corrected by Phase 1 — every one of them public,
     *      so the whole rank is public and computed here rather than under encryption. Criterion 4,
     *      the borrower's maturity preference, is encrypted and is applied by the engine as a
     *      higher-order term over this rank. Criteria 2 and 3 are not orderings: a leaf without
     *      capacity or below the privacy floor carries encrypted zero and can never win.
     *
     *      Lower is better, and the packing is positional so that no lower criterion can ever
     *      outrank a higher one:
     *
     *          rank = rateIndex * 512  +  [engine adds maturityDistance * 128]  +  tail
     *                 ^ criterion 1       ^ criterion 4, encrypted               ^ criteria 5,6,7
     *
     *      512 = 4 maturity buckets x 128, and the tail occupies exactly 7 bits, so the gap
     *      reserved for the encrypted maturity term cannot be reached by any tail value. The
     *      maximum rank is 15*512 + 3*128 + 127 = 8,191, comfortably inside `euint16`, which is
     *      what lets the whole reduction run at `euint16` width — 13% cheaper per select than
     *      `euint256` (OPERATION-BUDGET §6).
     */
    function publicLeafRank(bytes32 universeId, uint256 leafIndex) public view returns (uint16) {
        _requireKnown(universeId);
        Leaf storage leaf = _leaves[universeId][leafIndex];
        MarketSpec storage market = _markets[universeId][leaf.marketIndex];
        uint16 tail = uint16((uint256(market.publicPriority) << 4) | uint256(leaf.marketIndex));
        return uint16(uint256(leaf.rateIndex) * CURVE_RATE_RANK_STRIDE + uint256(tail));
    }

    /// @notice The stride the engine multiplies the encrypted maturity distance by. See above.
    uint16 public constant MATURITY_RANK_STRIDE = CURVE_MATURITY_RANK_STRIDE;
    /// @notice One more than the largest rank any leaf can carry. Used as the "never wins" score.
    uint16 public constant RANK_CEILING = CURVE_RANK_CEILING;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireKnown(bytes32 universeId) private view returns (UniverseHeader storage header) {
        header = _headers[universeId];
        if (header.curator == address(0)) revert UnknownUniverse(universeId);
    }

    function _requireDraft(bytes32 universeId) private view returns (UniverseHeader storage header) {
        header = _requireKnown(universeId);
        if (header.active) revert UniverseIsActive(universeId);
    }

    /**
     * @dev The four grid properties that are load-bearing, each with its own revert.
     *
     *      A grid that fails any of these compiles, deploys and produces confident-looking quotes
     *      that either revert inside Midnight's `take` or select the most expensive rate while
     *      claiming it is the cheapest.
     */
    function _validateGrid(
        uint16 marketIndex,
        MarketSpec calldata spec,
        int24[] calldata ticks,
        uint256[] calldata pricesWad
    ) private pure {
        for (uint256 r = 0; r < ticks.length; ++r) {
            int24 tick = ticks[r];
            uint256 price = pricesWad[r];

            if (tick % int24(uint24(spec.tickSpacing)) != 0) {
                revert TickNotOnSpacing(marketIndex, uint16(r), tick, spec.tickSpacing);
            }
            if (price > WAD) revert PriceAbovePar(marketIndex, uint16(r), price);
            if (price < spec.settlementFeeFloorWad) {
                revert PriceBelowSettlementFee(marketIndex, uint16(r), price, spec.settlementFeeFloorWad);
            }
            if (r > 0) {
                if (ticks[r - 1] <= tick) {
                    revert RateGridNotDescending(marketIndex, uint16(r), ticks[r - 1], tick);
                }
                if (pricesWad[r - 1] <= price) {
                    revert PriceGridNotDescending(marketIndex, uint16(r), pricesWad[r - 1], price);
                }
            }
        }
    }
}
