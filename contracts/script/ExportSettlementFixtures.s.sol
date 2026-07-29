// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {Script} from "forge-std/Script.sol";

import {CollateralParams, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {WAD} from "midnight/libraries/ConstantsLib.sol";

import {KyrveQuoteId} from "../kyrve/KyrveQuoteId.sol";
import {QuoteExecution, QuoteProvenance, QuoteStatus} from "../kyrve/KyrveQuoteTypes.sol";

/**
 * @dev Emits the differential fixture that pins `@kyrve/quote` to the Solidity it mirrors.
 *
 * The quote id is an `abi.encode` fold over twenty values, and `offer.group` carries it, and the
 * ratifier compares the offer hash byte for byte. So a single field reordered or retyped on either
 * side produces a keeper that builds offers no ratifier will ever accept — and it would do so
 * silently, because both sides would agree with themselves.
 *
 * The fixture is generated FROM the Solidity, never hand-written, exactly as
 * `ExportQuoteMathFixtures` is. `packages/quote/test/id.test.ts` then asserts equality for every
 * case, including one with the settlement layer's reference dust: a leaf that could carry
 * 300,000,000 reserving 299,999,999.
 *
 * Every value is serialised as a decimal STRING. JSON numbers are IEEE-754 doubles and would
 * silently lose precision above 2^53.
 *
 * Run: forge script contracts/script/ExportSettlementFixtures.s.sol
 */
contract ExportSettlementFixtures is Script {
    using UtilsLib for uint256;

    string internal constant OUT = "./packages/quote/test/fixtures/quote-binding.json";
    string internal constant OBJ = "kyrve.settlementFixture";

    /// @dev Synthetic but fixed. Nothing here is deployed; the point is a stable encoding.
    address internal constant REGISTRY = address(uint160(0xA1));
    address internal constant MIDNIGHT = address(uint160(0xB2));
    address internal constant VAULT = address(uint160(0xC3));
    address internal constant RATIFIER = address(uint160(0xD4));
    address internal constant TAKER = address(uint160(0xE5));
    address internal constant LOAN_TOKEN = address(uint160(0xF6));

    struct Case {
        string label;
        uint256 aggregate;
        int24 tick;
        uint8 marketIndex;
        uint8 rateIndex;
        uint16 leafIndex;
        uint40 expiry;
        uint128 maxPendingFee;
    }

    function run() external {
        Case[] memory cases = new Case[](4);
        cases[0] = Case("reference-dust", 299_999_999, 6000, 0, 0, 0, 1_800_000_000, 1_000_000);
        cases[1] = Case("round-aggregate", 1_000_000e6, 6000, 0, 0, 0, 1_800_000_000, 0);
        cases[2] = Case("high-tick", 500_000e6, 6744, 1, 2, 5, 1_900_000_000, 12_345);
        cases[3] = Case("low-tick", 250_000e6, 400, 3, 7, 31, 2_000_000_000, 99);

        bytes32 deploymentId = keccak256(abi.encode(block.chainid, REGISTRY, MIDNIGHT));
        bytes32 seriesId = keccak256(abi.encode("kyrve.series.v1", deploymentId, _marketId()));

        string[] memory labels = new string[](cases.length);
        string[] memory quoteIds = new string[](cases.length);
        string[] memory offerHashes = new string[](cases.length);
        string[] memory unitsOut = new string[](cases.length);
        string[] memory buyerAssetsOut = new string[](cases.length);
        string[] memory pricesOut = new string[](cases.length);
        string[] memory aggregatesOut = new string[](cases.length);
        string[] memory ticksOut = new string[](cases.length);
        string[] memory expiriesOut = new string[](cases.length);
        string[] memory feesOut = new string[](cases.length);
        string[] memory marketIndexesOut = new string[](cases.length);
        string[] memory rateIndexesOut = new string[](cases.length);
        string[] memory leafIndexesOut = new string[](cases.length);

        for (uint256 i = 0; i < cases.length; ++i) {
            (QuoteExecution memory execution, QuoteProvenance memory provenance, uint256 price) =
                _build(cases[i], deploymentId);

            bytes32 quoteId = KyrveQuoteId.compute(execution, provenance);
            Offer memory offer = _offer(cases[i], execution, quoteId);

            labels[i] = cases[i].label;
            quoteIds[i] = vm.toString(quoteId);
            offerHashes[i] = vm.toString(keccak256(abi.encode(offer)));
            unitsOut[i] = vm.toString(uint256(execution.exactUnits));
            buyerAssetsOut[i] = vm.toString(uint256(execution.expectedBuyerAssets));
            pricesOut[i] = vm.toString(price);
            aggregatesOut[i] = vm.toString(provenance.aggregateFillAmount);
            ticksOut[i] = vm.toString(int256(cases[i].tick));
            expiriesOut[i] = vm.toString(uint256(cases[i].expiry));
            feesOut[i] = vm.toString(uint256(cases[i].maxPendingFee));
            marketIndexesOut[i] = vm.toString(uint256(cases[i].marketIndex));
            rateIndexesOut[i] = vm.toString(uint256(cases[i].rateIndex));
            leafIndexesOut[i] = vm.toString(uint256(cases[i].leafIndex));
        }

        vm.serializeString(
            OBJ,
            "$comment",
            "GENERATED by contracts/script/ExportSettlementFixtures.s.sol from contracts/kyrve. Do not edit by hand."
        );
        vm.serializeString(OBJ, "chainId", vm.toString(block.chainid));
        vm.serializeString(OBJ, "registry", vm.toString(REGISTRY));
        vm.serializeString(OBJ, "midnight", vm.toString(MIDNIGHT));
        vm.serializeString(OBJ, "vault", vm.toString(VAULT));
        vm.serializeString(OBJ, "ratifier", vm.toString(RATIFIER));
        vm.serializeString(OBJ, "taker", vm.toString(TAKER));
        vm.serializeString(OBJ, "loanToken", vm.toString(LOAN_TOKEN));
        vm.serializeString(OBJ, "deploymentId", vm.toString(deploymentId));
        vm.serializeString(OBJ, "seriesId", vm.toString(seriesId));
        vm.serializeString(OBJ, "marketId", vm.toString(_marketId()));
        vm.serializeString(OBJ, "marketStructHash", vm.toString(keccak256(abi.encode(_market()))));
        vm.serializeString(OBJ, "epochId", vm.toString(_epochId()));
        vm.serializeString(OBJ, "graphRoot", vm.toString(_graphRoot()));
        vm.serializeString(OBJ, "requestId", vm.toString(_requestId()));
        vm.serializeString(OBJ, "universeId", vm.toString(_universeId()));
        vm.serializeString(OBJ, "maturity", vm.toString(_MATURITY));
        vm.serializeString(OBJ, "continuousFeeCap", vm.toString(_FEE_CAP));
        vm.serializeString(OBJ, "start", vm.toString(_START));
        vm.serializeString(OBJ, "labels", labels);
        vm.serializeString(OBJ, "aggregates", aggregatesOut);
        vm.serializeString(OBJ, "ticks", ticksOut);
        vm.serializeString(OBJ, "prices", pricesOut);
        vm.serializeString(OBJ, "units", unitsOut);
        vm.serializeString(OBJ, "buyerAssets", buyerAssetsOut);
        vm.serializeString(OBJ, "expiries", expiriesOut);
        vm.serializeString(OBJ, "maxPendingFees", feesOut);
        vm.serializeString(OBJ, "marketIndexes", marketIndexesOut);
        vm.serializeString(OBJ, "rateIndexes", rateIndexesOut);
        vm.serializeString(OBJ, "leafIndexes", leafIndexesOut);
        vm.serializeString(OBJ, "quoteIds", quoteIds);

        string memory out = vm.serializeString(OBJ, "offerHashes", offerHashes);
        vm.writeJson(out, OUT);
    }

    uint256 internal constant _MATURITY = 1_900_000_000;
    uint256 internal constant _FEE_CAP = 1000;
    uint256 internal constant _START = 1_700_000_000;

    function _epochId() internal pure returns (bytes32) {
        return keccak256("kyrve.fixture.epoch");
    }

    function _graphRoot() internal pure returns (bytes32) {
        return keccak256("kyrve.fixture.graphRoot");
    }

    function _requestId() internal pure returns (bytes32) {
        return keccak256("kyrve.fixture.request");
    }

    function _universeId() internal pure returns (bytes32) {
        return keccak256("kyrve.fixture.universe");
    }

    /// @dev One collateral leg, so the struct has the same shape a real market does — a market with
    ///      an empty `collateralParams` array is one Midnight would refuse, and a fixture that
    ///      encodes an impossible struct proves less than one that encodes a possible one.
    function _market() internal view returns (Market memory) {
        CollateralParams[] memory collateral = new CollateralParams[](1);
        collateral[0] = CollateralParams({
            token: address(uint160(0xA07)), lltv: 0.77e18, liquidationCursor: 0.3e18, oracle: address(uint160(0xB08))
        });

        return Market({
            chainId: block.chainid,
            midnight: MIDNIGHT,
            loanToken: LOAN_TOKEN,
            collateralParams: collateral,
            maturity: _MATURITY,
            rcfThreshold: 0,
            enterGate: address(0),
            liquidatorGate: address(0)
        });
    }

    function _marketId() internal view returns (bytes32) {
        return keccak256(abi.encode("kyrve.fixture.marketId", keccak256(abi.encode(_market()))));
    }

    function _build(Case memory testCase, bytes32 deploymentId)
        internal
        view
        returns (QuoteExecution memory execution, QuoteProvenance memory provenance, uint256 price)
    {
        price = TickLib.tickToPrice(uint256(uint24(testCase.tick)));
        uint256 units = testCase.aggregate.mulDivDown(WAD, price);
        uint256 buyerAssets = units.mulDivDown(price, WAD);

        provenance = QuoteProvenance({
            epochId: _epochId(),
            graphRoot: _graphRoot(),
            requestId: _requestId(),
            universeId: _universeId(),
            deploymentId: deploymentId,
            marketStructHash: keccak256(abi.encode(_market())),
            aggregateFillAmount: testCase.aggregate,
            tick: testCase.tick,
            marketIndex: testCase.marketIndex,
            rateIndex: testCase.rateIndex,
            leafIndex: testCase.leafIndex
        });

        execution = QuoteExecution({
            offerHash: bytes32(0),
            marketId: _marketId(),
            // forge-lint: disable-next-line(unsafe-typecast)
            exactUnits: uint128(units),
            // forge-lint: disable-next-line(unsafe-typecast)
            expectedBuyerAssets: uint128(buyerAssets),
            maxPendingFee: testCase.maxPendingFee,
            expiry: testCase.expiry,
            activatedAt: 0,
            status: QuoteStatus.Executable,
            taker: TAKER,
            vault: VAULT,
            ratifier: RATIFIER
        });
    }

    function _offer(Case memory testCase, QuoteExecution memory execution, bytes32 quoteId)
        internal
        view
        returns (Offer memory)
    {
        return Offer({
            market: _market(),
            buy: true,
            maker: VAULT,
            start: _START,
            expiry: execution.expiry,
            tick: uint256(uint24(testCase.tick)),
            group: quoteId,
            callback: VAULT,
            callbackData: abi.encode(quoteId),
            receiverIfMakerIsSeller: address(0),
            ratifier: RATIFIER,
            reduceOnly: false,
            maxUnits: execution.exactUnits,
            maxAssets: 0,
            continuousFeeCap: _FEE_CAP
        });
    }
}
