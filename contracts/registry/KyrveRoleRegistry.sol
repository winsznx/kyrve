// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/// @title KyrveRoleRegistry
/// @notice The on-chain declaration of who holds each operational role in ONE Kyrve deployment,
/// and the structural proof that no two of them are the same address.
///
/// ════════════════════════════════════════════════════════════════════════════════════════════
/// WHY THIS EXISTS AT ALL, WHEN EVERY ROLE IS ALREADY AN IMMUTABLE SOMEWHERE ELSE
/// ════════════════════════════════════════════════════════════════════════════════════════════
///
/// Every authority Kyrve grants is already an `immutable` on the contract that enforces it:
/// `QuoteActivator.KEEPER`, `KyrveSeriesVault.OPERATOR`, `KyrveSeriesToken.CURATOR`,
/// `KyrveEmergencyController.guardian`, `SeriesResidueAccount.DECLARED_BENEFICIARY`. Enforcement
/// lives there and stays there — this registry enforces nothing and can enforce nothing.
///
/// What it adds is the one thing those scattered immutables cannot express: **that they are
/// different addresses**. Through Phase 5 they were all one Sepolia key, and nothing on chain said
/// so or could have said otherwise. Reading five getters and comparing them is a check a verifier
/// might do; a constructor that refuses to exist unless they differ is a check the deployment
/// cannot skip. Phase 5's `docs/phase5/PHASE-6-PREREQUISITES.md` P6-0 names exactly this as the
/// thing left undone, and names it a *deployment* problem — so the fix belongs at deployment time.
///
/// It also gives Kyrve Verify and the proof pages one address to read a whole role model from, and
/// gives Capsule a chain-anchored notion of "the declared auditor" that is not a manifest entry.
///
/// ════════════════════════════════════════════════════════════════════════════════════════════
/// WHAT IT DELIBERATELY IS NOT
/// ════════════════════════════════════════════════════════════════════════════════════════════
///
/// There is no setter, no owner, no admin, no rotation function and no upgrade path. Every field is
/// `immutable`. A registry that could reassign a role would be a role of its own — the most powerful
/// one in the system — and it would make "the keeper cannot alter outcomes" false by construction.
/// Rotation is a redeployment, and `docs/phase6/ROLES.md` states what that costs for each role.
///
/// It holds no value, has no token approval, makes no external call, and reads no confidential
/// handle. There is nothing here for an attacker to take and nothing to redirect.
///
/// ════════════════════════════════════════════════════════════════════════════════════════════
/// THE ACCOUNT-KIND RECORD, AND ITS HONEST LIMIT
/// ════════════════════════════════════════════════════════════════════════════════════════════
///
/// `accountKindBitmap` records, per role, whether the address had code AT CONSTRUCTION TIME. That
/// answers "is this role a contract or a bare key" for the deployment record, which the brief
/// requires and which materially changes the threat model for each role.
///
/// It is a snapshot and is documented as one. An address with no code today can gain code tomorrow
/// through CREATE2 at a pre-computed address, or behave like a contract through an EIP-7702
/// delegation that leaves `extcodesize` non-zero but is not a contract account in the usual sense.
/// This registry states what was true when it was deployed and never claims to track what is true
/// now. A verifier that needs the live answer must read `extcodesize` itself, and Kyrve Verify does.
contract KyrveRoleRegistry {
    /// @dev The seven operational roles. Ordering is part of the ABI — append only, never reorder.
    ///
    /// DEPLOYER            deploys contracts and performs the one-shot bindings. Has no runtime
    ///                     authority afterwards: every `onlyDeployer` function on the confidential
    ///                     layer is a bind-once that reverts forever after it is used.
    /// KEEPER              advances computation. Runs curve stages, activates quotes, consumes and
    ///                     allocates chunks. Cannot choose inputs and cannot change outcomes.
    /// OPERATOR            declared operational actions only: retiring an expired quote, recovering
    ///                     funding from a series vault whose quote never settled.
    /// CURATOR             registers reviewed universes and markets, creates series, sets the public
    ///                     redemption factor, publishes the aggregate supply snapshot. Moves no funds.
    /// EMERGENCY_AUTHORITY pauses and unpauses protocol ENTRIES. Cannot pause any recovery path,
    ///                     because `KyrveEmergencyController`'s enum has no member for one.
    /// RESIDUE_BENEFICIARY receives the funding residue. Purely a destination — holds no authority
    ///                     anywhere in the system and cannot call anything privileged.
    /// AUDITOR             the declared recipient of Kyrve Capsule snapshots. Read-only by
    ///                     construction: a capsule carries frozen snapshot handles and never a live
    ///                     balance handle.
    enum Role {
        Deployer,
        Keeper,
        Operator,
        Curator,
        EmergencyAuthority,
        ResidueBeneficiary,
        Auditor
    }

    uint256 public constant ROLE_COUNT = 7;

    error DuplicateRoleHolder(Role first, Role second, address holder);
    error UnknownRole(uint256 role);
    error WrongChain(uint256 expected, uint256 actual);
    error ZeroRoleHolder(Role role);

    /// @notice Binds this role set to one deployment, so a role table cannot be read against the
    /// wrong layer. Kyrve Verify compares it against `QuoteActivator.DEPLOYMENT_ID`.
    bytes32 public immutable DEPLOYMENT_ID;
    uint256 public immutable CHAIN_ID;
    uint64 public immutable DECLARED_AT;

    address public immutable DEPLOYER;
    address public immutable KEEPER;
    address public immutable OPERATOR;
    address public immutable CURATOR;
    address public immutable EMERGENCY_AUTHORITY;
    address public immutable RESIDUE_BENEFICIARY;
    address public immutable AUDITOR;

    /// @notice Bit `i` is set when the holder of `Role(i)` had code at construction time.
    /// @dev A snapshot, not a live answer. See the contract-level note.
    uint256 public immutable ACCOUNT_KIND_BITMAP;

    event RolesDeclared(bytes32 indexed deploymentId, uint256 accountKindBitmap);

    /// @param holderList one address per {Role}, in enum order.
    constructor(bytes32 deploymentId, uint256 chainId, address[ROLE_COUNT] memory holderList) {
        require(chainId == block.chainid, WrongChain(block.chainid, chainId));

        uint256 bitmap;
        for (uint256 i = 0; i < ROLE_COUNT; ++i) {
            address holder = holderList[i];
            require(holder != address(0), ZeroRoleHolder(Role(i)));

            // Pairwise, not a set membership test. The revert names BOTH roles, because "these two
            // collapsed" is the actionable fact and "this address appears twice" is not.
            for (uint256 j = 0; j < i; ++j) {
                require(holderList[j] != holder, DuplicateRoleHolder(Role(j), Role(i), holder));
            }

            uint256 size;
            assembly ("memory-safe") {
                size := extcodesize(holder)
            }
            if (size != 0) bitmap |= (1 << i);
        }

        DEPLOYMENT_ID = deploymentId;
        CHAIN_ID = chainId;
        DECLARED_AT = uint64(block.timestamp);

        DEPLOYER = holderList[uint256(Role.Deployer)];
        KEEPER = holderList[uint256(Role.Keeper)];
        OPERATOR = holderList[uint256(Role.Operator)];
        CURATOR = holderList[uint256(Role.Curator)];
        EMERGENCY_AUTHORITY = holderList[uint256(Role.EmergencyAuthority)];
        RESIDUE_BENEFICIARY = holderList[uint256(Role.ResidueBeneficiary)];
        AUDITOR = holderList[uint256(Role.Auditor)];
        ACCOUNT_KIND_BITMAP = bitmap;

        emit RolesDeclared(deploymentId, bitmap);
    }

    /// @notice The declared holder of one role.
    function holderOf(Role role) public view returns (address) {
        if (role == Role.Deployer) return DEPLOYER;
        if (role == Role.Keeper) return KEEPER;
        if (role == Role.Operator) return OPERATOR;
        if (role == Role.Curator) return CURATOR;
        if (role == Role.EmergencyAuthority) return EMERGENCY_AUTHORITY;
        if (role == Role.ResidueBeneficiary) return RESIDUE_BENEFICIARY;
        return AUDITOR;
    }

    /// @notice Every holder in enum order, for a verifier that wants one call.
    function holders() external view returns (address[ROLE_COUNT] memory list) {
        for (uint256 i = 0; i < ROLE_COUNT; ++i) {
            list[i] = holderOf(Role(i));
        }
    }

    /// @notice Whether the holder of `role` had code when this registry was deployed.
    function wasContractAtDeclaration(Role role) external view returns (bool) {
        return (ACCOUNT_KIND_BITMAP >> uint256(role)) & 1 == 1;
    }

    /// @notice Whether the holder of `role` has code NOW. The live answer, distinct from the
    /// snapshot, and the one a verifier should use when the distinction matters.
    function isContractNow(Role role) external view returns (bool) {
        address holder = holderOf(role);
        uint256 size;
        assembly ("memory-safe") {
            size := extcodesize(holder)
        }
        return size != 0;
    }

    /// @notice The role `who` holds, if any.
    /// @return found false when `who` holds no role. `role` is meaningless in that case.
    function roleOf(address who) external view returns (bool found, Role role) {
        if (who == address(0)) return (false, Role.Deployer);
        for (uint256 i = 0; i < ROLE_COUNT; ++i) {
            if (holderOf(Role(i)) == who) return (true, Role(i));
        }
        return (false, Role.Deployer);
    }

    /// @notice Always true for a registry that exists.
    /// @dev Deliberately trivial, and it is the point: the constructor already refused every
    /// non-separated role set, so a deployed `KyrveRoleRegistry` IS the proof. A verifier calling
    /// this is reading a fact, not asking for a re-check, and there is no state that could have
    /// drifted since — every field is `immutable`.
    function rolesAreSeparated() external pure returns (bool) {
        return true;
    }
}
