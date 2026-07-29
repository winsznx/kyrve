// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/// @dev The on-chain anchor for exactly which protocol deployment Kyrve supports.
///
/// SCOPE. This is the Phase 1 foundation registry and nothing more. It records which Midnight
/// deployment, which Nox deployment and which Kyrve build this chain is running, and it refuses to
/// answer "supported" for anything else. It deliberately does NOT contain the product registry,
/// governance, the mandate book, the request book or universe logic — those are later phases, and
/// putting placeholder surfaces here would create an upgrade path nobody designed.
///
/// WHY ON CHAIN AT ALL. Off-chain manifests can be regenerated, edited or served stale. Contracts
/// that settle real value need a source of truth that a verifier can read from the same chain the
/// settlement happens on. `KyrveDeploymentVerifier` reads this registry and compares it against
/// live chain state, so a mismatch between what Kyrve thinks it deployed and what is actually
/// deployed is detectable from on chain alone.
///
/// MUTABILITY. Records are write-once per version. The `admin` may publish a NEW version, never
/// silently rewrite an existing one, so a historical record stays auditable. Emergency state is the
/// single exception: it is a live switch by design.
contract KyrveProtocolRegistry {
    error AlreadyRegistered(uint256 version);
    error NotAdmin(address caller);
    error NotPendingAdmin(address caller);
    error UnknownVersion(uint256 version);
    error WrongChain(uint256 expected, uint256 actual);
    error ZeroAddress(string field);

    /// @dev One immutable description of a complete Kyrve deployment.
    struct Deployment {
        uint256 chainId;
        // --- Morpho Midnight ---
        address midnight;
        /// @dev keccak256 of the pinned release tag, e.g. keccak256("2026-07-23").
        bytes32 midnightRelease;
        /// @dev keccak256 of the deployed Midnight runtime bytecode.
        bytes32 midnightRuntimeHash;
        // --- iExec Nox ---
        address noxCompute;
        /// @dev The NoxCompute implementation behind the ERC-1967 proxy, as read from the
        /// EIP-1967 slot OFF CHAIN at registration time. A contract cannot read another
        /// contract's storage, so the proxy-to-implementation binding is established by
        /// `verify:deployment` via `eth_getStorageAt`; what this registry pins is the
        /// implementation itself, whose code hash IS checkable on chain.
        address noxImplementation;
        /// @dev keccak256 of the NoxCompute implementation runtime bytecode. Nox is a UUPS proxy
        /// whose implementation can be rotated, and rotation is a total change in behaviour, so
        /// pinning the proxy address alone would detect nothing.
        bytes32 noxImplementationHash;
        // --- Kyrve ---
        /// @dev keccak256 of the Kyrve source revision this deployment was built from.
        bytes32 kyrveVersion;
        /// @dev keccak256 of the off-chain deployment manifest, binding the two together.
        bytes32 manifestHash;
        /// @dev keccak256 of LICENSE at deployment time. A licence disclosure that has since
        /// changed becomes detectable rather than silently stale.
        bytes32 licenceDisclosureHash;
        address osakaProbe;
        uint64 registeredAt;
        bool exists;
    }

    address public admin;
    address public pendingAdmin;

    /// @dev Halts Kyrve-side operation without touching Midnight or Nox. Kyrve cannot pause the
    /// protocols it integrates and must never claim to.
    bool public emergencyStopped;

    uint256 public latestVersion;
    mapping(uint256 version => Deployment) internal _deployments;

    /// @dev ERC-7984 confidential wrappers, registered per underlying token. Populated as series
    /// are created in a later phase; empty in Phase 1 rather than pre-filled with guesses.
    mapping(address underlying => address wrapper) public confidentialWrapper;

    event DeploymentRegistered(uint256 indexed version, bytes32 manifestHash, address midnight);
    event ConfidentialWrapperSet(address indexed underlying, address indexed wrapper);
    event EmergencyStopSet(bool stopped);
    event AdminTransferStarted(address indexed from, address indexed to);
    event AdminTransferred(address indexed from, address indexed to);

    constructor(address initialAdmin) {
        require(initialAdmin != address(0), ZeroAddress("initialAdmin"));
        admin = initialAdmin;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, NotAdmin(msg.sender));
        _;
    }

    // ---------------------------------------------------------------------------------------
    // Deployment records
    // ---------------------------------------------------------------------------------------

    /// @dev Publishes a new deployment version. Never overwrites an existing one.
    function registerDeployment(uint256 version, Deployment calldata d) external onlyAdmin {
        require(!_deployments[version].exists, AlreadyRegistered(version));
        require(d.chainId == block.chainid, WrongChain(block.chainid, d.chainId));
        require(d.midnight != address(0), ZeroAddress("midnight"));
        require(d.noxCompute != address(0), ZeroAddress("noxCompute"));
        require(d.osakaProbe != address(0), ZeroAddress("osakaProbe"));

        Deployment storage stored = _deployments[version];
        stored.chainId = d.chainId;
        stored.midnight = d.midnight;
        stored.midnightRelease = d.midnightRelease;
        stored.midnightRuntimeHash = d.midnightRuntimeHash;
        stored.noxCompute = d.noxCompute;
        stored.noxImplementation = d.noxImplementation;
        stored.noxImplementationHash = d.noxImplementationHash;
        stored.kyrveVersion = d.kyrveVersion;
        stored.manifestHash = d.manifestHash;
        stored.licenceDisclosureHash = d.licenceDisclosureHash;
        stored.osakaProbe = d.osakaProbe;
        stored.registeredAt = uint64(block.timestamp);
        stored.exists = true;

        if (version > latestVersion) latestVersion = version;

        emit DeploymentRegistered(version, d.manifestHash, d.midnight);
    }

    function deployment(uint256 version) external view returns (Deployment memory) {
        Deployment memory d = _deployments[version];
        require(d.exists, UnknownVersion(version));
        return d;
    }

    function currentDeployment() external view returns (Deployment memory) {
        Deployment memory d = _deployments[latestVersion];
        require(d.exists, UnknownVersion(latestVersion));
        return d;
    }

    /// @dev The whole point of the registry: a flat, unambiguous answer. Returns false for any
    /// address the registry does not itself hold, never "probably".
    function isSupportedMidnight(address midnight) external view returns (bool) {
        Deployment storage d = _deployments[latestVersion];
        return d.exists && d.midnight == midnight && midnight != address(0);
    }

    function isSupportedNoxCompute(address noxCompute) external view returns (bool) {
        Deployment storage d = _deployments[latestVersion];
        return d.exists && d.noxCompute == noxCompute && noxCompute != address(0);
    }

    // ---------------------------------------------------------------------------------------
    // Confidential wrappers
    // ---------------------------------------------------------------------------------------

    function setConfidentialWrapper(address underlying, address wrapper) external onlyAdmin {
        require(underlying != address(0), ZeroAddress("underlying"));
        confidentialWrapper[underlying] = wrapper;
        emit ConfidentialWrapperSet(underlying, wrapper);
    }

    // ---------------------------------------------------------------------------------------
    // Emergency state
    // ---------------------------------------------------------------------------------------

    /// @dev Stops Kyrve-side operation only. Midnight positions and Nox handles are unaffected —
    /// Kyrve has no authority over either, and the UI must not imply otherwise.
    function setEmergencyStopped(bool stopped) external onlyAdmin {
        emergencyStopped = stopped;
        emit EmergencyStopSet(stopped);
    }

    // ---------------------------------------------------------------------------------------
    // Admin transfer — two-step, so a typo cannot orphan the registry
    // ---------------------------------------------------------------------------------------

    function beginAdminTransfer(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), ZeroAddress("newAdmin"));
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdminTransfer() external {
        require(msg.sender == pendingAdmin, NotPendingAdmin(msg.sender));
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }
}
