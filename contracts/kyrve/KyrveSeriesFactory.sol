// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {KyrveQuoteRegistry} from "./KyrveQuoteRegistry.sol";
import {KyrveSeriesVault} from "./KyrveSeriesVault.sol";

/**
 * @title KyrveSeriesFactory
 * @notice One series, one vault, one deterministic address (PRD §13.12).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY SERIES CREATION IS CURATED AND VAULT SELECTION IS NOT A PARAMETER
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `QuoteActivator` does not take a vault address. It DERIVES one: `seriesId` is a fold over the
 * deployment and the market id, and the vault is whatever this factory registered for that series.
 * The alternative — letting the activator's caller name a vault — would let an attacker present a
 * contract of their own as the maker, and that contract's `onBuy` could return `CALLBACK_SUCCESS`
 * for any fill size at all. Exact-fill enforcement is only as strong as the guarantee that the
 * enforcing code is Kyrve's.
 *
 * So the guarantee is structural: a quote can only ever bind to a vault this factory deployed, from
 * this factory's own creation code, with immutables this factory supplied. There is no
 * `registerVault(address)` and there will not be one.
 *
 * Creation is restricted to the curator for the same reason universe creation is: a series names a
 * market Kyrve is willing to be the maker in, and that is a curatorial judgement, not an open
 * endpoint. The curator address is immutable — a settable curator is a mutable series set.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is public: which series exist, which market each is for, which token it funds in
 * and where its vault lives. No confidential value is representable in this contract.
 */
contract KyrveSeriesFactory {
    error NotCurator(address caller, address expected);
    error SeriesExists(bytes32 seriesId, address vault);
    error UnknownSeries(bytes32 seriesId);
    error ZeroAddress(string field);
    error ZeroValue(string field);

    event SeriesCreated(
        bytes32 indexed seriesId, bytes32 indexed marketId, address indexed vault, address loanToken, address operator
    );

    address public immutable MIDNIGHT;
    KyrveQuoteRegistry public immutable REGISTRY;
    address public immutable ACTIVATOR;
    address public immutable EXPIRY_CONTROLLER;
    address public immutable CURATOR;
    bytes32 public immutable DEPLOYMENT_ID;

    mapping(bytes32 seriesId => address vault) public vaultOf;
    mapping(address vault => bytes32 seriesId) public seriesOf;
    address[] private _vaults;

    constructor(KyrveQuoteRegistry registry, address activator, address expiryController, address curator) {
        require(address(registry) != address(0), ZeroAddress("registry"));
        require(activator != address(0), ZeroAddress("activator"));
        require(expiryController != address(0), ZeroAddress("expiryController"));
        require(curator != address(0), ZeroAddress("curator"));

        REGISTRY = registry;
        MIDNIGHT = registry.MIDNIGHT();
        ACTIVATOR = activator;
        EXPIRY_CONTROLLER = expiryController;
        CURATOR = curator;
        DEPLOYMENT_ID = registry.DEPLOYMENT_ID();
    }

    /**
     * @notice The series identifier for one Midnight market under this deployment.
     * @dev Folded over `DEPLOYMENT_ID` so the same market on two Kyrve deployments is two series
     *      with two vaults at two addresses. A market id already embeds the chain and the Midnight
     *      address, so this adds the Kyrve deployment on top of Midnight's own replay protection.
     */
    function seriesIdFor(bytes32 marketId) public view returns (bytes32) {
        return keccak256(abi.encode("kyrve.series.v1", DEPLOYMENT_ID, marketId));
    }

    /// @notice Deploys the vault for one market. Curator only, once per series, forever.
    function createSeries(bytes32 marketId, address loanToken, address operator)
        external
        returns (bytes32 seriesId, address vault)
    {
        require(msg.sender == CURATOR, NotCurator(msg.sender, CURATOR));
        require(marketId != bytes32(0), ZeroValue("marketId"));
        require(loanToken != address(0), ZeroAddress("loanToken"));
        require(operator != address(0), ZeroAddress("operator"));

        seriesId = seriesIdFor(marketId);
        address existing = vaultOf[seriesId];
        require(existing == address(0), SeriesExists(seriesId, existing));

        vault = address(
            new KyrveSeriesVault{salt: seriesId}(
                MIDNIGHT, REGISTRY, ACTIVATOR, EXPIRY_CONTROLLER, loanToken, operator, seriesId
            )
        );

        vaultOf[seriesId] = vault;
        seriesOf[vault] = seriesId;
        _vaults.push(vault);

        emit SeriesCreated(seriesId, marketId, vault, loanToken, operator);
    }

    /// @notice Reverts unless a series exists, rather than returning the zero address. A zero
    ///         return would compare equal to an uninitialised expectation downstream.
    function requireVault(bytes32 seriesId) external view returns (address vault) {
        vault = vaultOf[seriesId];
        require(vault != address(0), UnknownSeries(seriesId));
    }

    function isVault(address vault) external view returns (bool) {
        return seriesOf[vault] != bytes32(0);
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }
}
