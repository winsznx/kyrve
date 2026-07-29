// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/**
 * @notice Loan tokens that behave badly in the ways that actually reach the maker.
 *
 * A vault's only token interactions are `balanceOf`, `allowance`, `approve` and `transfer`, and the
 * only one that can lie without reverting is `approve`. Three shapes are covered:
 *
 *   FALSE-RETURN   returns `false` instead of reverting. Discarding that return would leave the
 *                  allowance unset and the failure would surface much later, as an opaque revert
 *                  inside Midnight's `transferFrom`, with the maker unable to say why.
 *   SILENT         returns nothing at all. The ABI decoder rejects the empty return value, so the
 *                  call reverts inside the vault. Failing closed is the correct outcome, and it is
 *                  asserted rather than assumed — "it probably reverts somewhere" is not a security
 *                  property.
 *   RE-ENTRANT     calls back into Kyrve from inside `approve`, which is the only external call the
 *                  vault makes while a settlement is in flight.
 *
 * `TestERC20` is not extended because its `approve` is not `virtual`, and making it virtual would
 * change a contract that is already deployed and bytecode-locked on Sepolia.
 */
abstract contract MinimalERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientAllowance(uint256 available, uint256 required);
    error InsufficientBalance(uint256 available, uint256 required);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != from) {
            uint256 allowed = allowance[from][msg.sender];
            if (allowed != type(uint256).max) {
                require(allowed >= amount, InsufficientAllowance(allowed, amount));
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 available = balanceOf[from];
        require(available >= amount, InsufficientBalance(available, amount));
        balanceOf[from] = available - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract FalseApprovingERC20 is MinimalERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) MinimalERC20(name_, symbol_, decimals_) {}

    /// @dev Signals failure by return value and never sets an allowance.
    function approve(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract SilentApprovingERC20 is MinimalERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) MinimalERC20(name_, symbol_, decimals_) {}

    /// @dev Returns nothing, like the well-known non-compliant tokens.
    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }
}

contract ReentrantApprovingERC20 is MinimalERC20 {
    address public target;
    bytes public payload;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) MinimalERC20(name_, symbol_, decimals_) {}

    /// @dev Armed after deployment: the vault address is CREATE2-derived by the factory and is not
    ///      knowable when the token is constructed.
    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (target != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            // The outcome is recorded rather than bubbled: the assertion the test makes is that the
            // re-entrant settlement FAILED, and bubbling would hide that behind the outer revert.
            (bool ok,) = target.call(payload);
            reentrySucceeded = ok;
        }
        allowance[msg.sender][spender] = amount;
        return true;
    }
}
