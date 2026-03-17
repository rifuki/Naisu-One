// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal Wormhole mock for testing. Stores published messages and
///      allows tests to inject pre-built VMs via setNextVM().
contract MockWormhole {
    uint64 public nextSequence;
    uint256 public fee;

    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        bytes32 hash;
    }

    // Injected by tests before calling settleOrder / claim
    bytes private _nextEncodedVM;
    VM   private _nextVM;
    bool private _nextValid;
    string private _nextReason;

    event MessagePublished(address sender, uint64 sequence, bytes payload);

    constructor(uint256 _fee) {
        fee = _fee;
    }

    function messageFee() external view returns (uint256) {
        return fee;
    }

    function publishMessage(
        uint32, /*nonce*/
        bytes memory payload,
        uint8  /*consistencyLevel*/
    ) external payable returns (uint64 sequence) {
        require(msg.value >= fee, "Insufficient fee");
        sequence = nextSequence++;
        emit MessagePublished(msg.sender, sequence, payload);
    }

    function parseAndVerifyVM(bytes calldata /*encodedVM*/)
        external
        view
        returns (VM memory vm, bool valid, string memory reason)
    {
        return (_nextVM, _nextValid, _nextReason);
    }

    // --- Test helpers ---

    function setNextVM(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        bytes32 hash,
        bytes memory payload,
        bool valid,
        string memory reason
    ) external {
        _nextVM = VM({
            version: 1,
            timestamp: 0,
            nonce: 0,
            emitterChainId: emitterChainId,
            emitterAddress: emitterAddress,
            sequence: 0,
            consistencyLevel: 200,
            payload: payload,
            guardianSetIndex: 0,
            hash: hash
        });
        _nextValid = valid;
        _nextReason = reason;
    }
}
