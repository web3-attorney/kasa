// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract KasaRegistry {
    error UsernameTaken();
    error AlreadyRegistered();
    error InvalidUsername();
    error NoCommitment();
    error CommitTooRecent();
    error InvalidCommitment();

    mapping(bytes32 => address) private usernameToAddress;
    mapping(address => string) private addressToUsername;
    mapping(address => bytes32) public commitments;
    mapping(address => uint256) public commitBlocks;

    event UsernameRegistered(address indexed wallet, string username);

    function commit(bytes32 commitment) external {
        commitments[msg.sender] = commitment;
        commitBlocks[msg.sender] = block.number;
    }

    /// @dev On Arc, the permissioned validator set and sub-second finality make mempool front-running negligible. A commit-reveal scheme is not used intentionally to keep UX simple.
    function register(string calldata username, bytes32 salt) external {
        _validateUsername(username);

        if (bytes(addressToUsername[msg.sender]).length != 0) revert AlreadyRegistered();

        bytes32 storedCommitment = commitments[msg.sender];
        if (storedCommitment == bytes32(0)) revert NoCommitment();
        if (block.number < commitBlocks[msg.sender] + 2) revert CommitTooRecent();

        bytes32 revealCommitment = keccak256(abi.encodePacked(username, salt));
        if (storedCommitment != revealCommitment) revert InvalidCommitment();

        bytes32 usernameHash = keccak256(bytes(username));
        if (usernameToAddress[usernameHash] != address(0)) revert UsernameTaken();

        usernameToAddress[usernameHash] = msg.sender;
        addressToUsername[msg.sender] = username;

        delete commitments[msg.sender];
        delete commitBlocks[msg.sender];

        emit UsernameRegistered(msg.sender, username);
    }

    function resolve(string calldata username) external view returns (address) {
        return usernameToAddress[keccak256(bytes(username))];
    }

    function reverseResolve(address wallet) external view returns (string memory) {
        return addressToUsername[wallet];
    }

    function hasUsername(address wallet) external view returns (bool) {
        return bytes(addressToUsername[wallet]).length != 0;
    }

    function _validateUsername(string calldata u) internal pure {
        bytes calldata b = bytes(u);
        uint256 len = b.length;

        if (len < 3 || len > 20) revert InvalidUsername();

        for (uint256 i = 0; i < len; ++i) {
            bytes1 c = b[i];
            bool isLower = c >= 0x61 && c <= 0x7A; // a-z
            bool isDigit = c >= 0x30 && c <= 0x39; // 0-9
            bool isUnderscore = c == 0x5F; // _

            if (!isLower && !isDigit && !isUnderscore) revert InvalidUsername();
        }
    }
}
