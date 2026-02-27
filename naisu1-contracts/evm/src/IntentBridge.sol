// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// === Wormhole Interface ===
interface IWormhole {
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

    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    function parseAndVerifyVM(
        bytes calldata encodedVM
    ) external view returns (VM memory vm, bool valid, string memory reason);

    function messageFee() external view returns (uint256);
}

contract IntentBridge {
    // === Structs ===
    struct Order {
        address creator;
        bytes32 recipient;
        uint16 destinationChain;
        uint256 amount;
        uint256 startPrice;
        uint256 floorPrice;
        uint256 deadline;
        uint256 createdAt;
        uint8 status;
        bool withStake; // if true, solver should liquid-stake the delivered SOL on behalf of recipient
    }

    // === State ===
    address public owner;
    mapping(bytes32 => Order) public orders;
    uint256 public orderCount;

    // === Wormhole State ===
    IWormhole public wormhole;
    /// chainId (Wormhole) => expected emitter address (bytes32)
    mapping(uint16 => bytes32) public registeredEmitters;
    mapping(bytes32 => bool) public processedVaas;
    uint8 public immutable consistencyLevel; // 0=latest(fast), 1=safe(~18min), 200=finalized

    // === Events ===
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed creator,
        bytes32 recipient,
        uint16 destinationChain,
        uint256 amount,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 deadline,
        bool withStake
    );
    event OrderFulfilled(bytes32 indexed orderId, address indexed solver);
    event OrderCancelled(bytes32 indexed orderId);
    event EmitterRegistered(uint16 indexed chainId, bytes32 emitter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _wormhole, uint8 _consistencyLevel) {
        owner = msg.sender;
        wormhole = IWormhole(_wormhole);
        consistencyLevel = _consistencyLevel;
    }

    // === Admin Functions ===

    /// @notice Register (or update) the expected emitter for a source chain.
    /// @param chainId  Wormhole chain ID of the source chain (e.g. 1=Solana, 21=Sui, 6=Fuji)
    /// @param emitter  Expected 32-byte emitter address from that chain
    function registerEmitter(uint16 chainId, bytes32 emitter) external onlyOwner {
        require(emitter != bytes32(0), "Zero emitter");
        registeredEmitters[chainId] = emitter;
        emit EmitterRegistered(chainId, emitter);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // === User Functions ===

    /// @notice Lock ETH and request it be bridged to `destinationChain`.
    /// @param recipient        Destination address (32 bytes — Sui object ID, Solana pubkey, etc.)
    /// @param destinationChain Wormhole chain ID of destination (21=Sui, 1=Solana, …)
    /// @param startPrice       Initial auction price (in destination-chain smallest unit)
    /// @param floorPrice       Minimum acceptable price (same unit as startPrice)
    /// @param durationSeconds  How long the Dutch auction runs
    /// @param withStake        If true, the solver should liquid-stake the delivered assets on behalf of recipient
    function createOrder(
        bytes32 recipient,
        uint16 destinationChain,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 durationSeconds,
        bool withStake
    ) external payable returns (bytes32 orderId) {
        require(msg.value > 0, "No ETH sent");
        require(startPrice >= floorPrice, "Invalid price range");
        require(durationSeconds > 0, "Invalid duration");
        require(recipient != bytes32(0), "Invalid recipient: zero");

        orderId = keccak256(abi.encodePacked(msg.sender, orderCount, block.timestamp));
        orderCount++;

        orders[orderId] = Order({
            creator: msg.sender,
            recipient: recipient,
            destinationChain: destinationChain,
            amount: msg.value,
            startPrice: startPrice,
            floorPrice: floorPrice,
            deadline: block.timestamp + durationSeconds,
            createdAt: block.timestamp,
            status: 0,
            withStake: withStake
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            recipient,
            destinationChain,
            msg.value,
            startPrice,
            floorPrice,
            block.timestamp + durationSeconds,
            withStake
        );
    }

    function cancelOrder(bytes32 orderId) external {
        Order storage order = orders[orderId];
        require(order.status == 0, "Order not active");
        require(order.creator == msg.sender, "Not creator");

        order.status = 2;

        (bool success,) = payable(msg.sender).call{value: order.amount}("");
        require(success, "Refund failed");

        emit OrderCancelled(orderId);
    }

    function getAuctionPrice(bytes32 orderId) external view returns (uint256) {
        Order storage order = orders[orderId];

        if (block.timestamp >= order.deadline) return order.floorPrice;

        uint256 elapsed = block.timestamp - order.createdAt;
        uint256 totalDuration = order.deadline - order.createdAt;
        uint256 priceRange = order.startPrice - order.floorPrice;
        uint256 decay = (priceRange * elapsed) / totalDuration;

        return order.startPrice - decay;
    }

    // === Solver Functions (Wormhole) ===

    /// @notice Cross-chain direction: Solver sends ETH to `recipient` on this chain
    ///         and publishes a Wormhole proof for the destination chain to claim.
    ///
    /// Used for Sui→EVM and Solana→EVM flows (destination chain calls claim_with_vaa).
    ///
    /// Payload (96 bytes, same format as Sui/Solana programs):
    ///   [0..32]  intentId / orderId
    ///   [32..64] solver address (padded to 32 bytes)
    ///   [64..96] amount (in gwei: amountToSend / 1e9) as uint256 big-endian
    ///
    /// @param intentId  The intent/order ID on the source chain (bytes32)
    /// @param recipient The EVM address that receives ETH
    function fulfillAndProve(
        bytes32 intentId,
        address recipient
    ) external payable returns (uint64 sequence) {
        uint256 fee = wormhole.messageFee();
        require(msg.value > fee, "Insufficient value: need ETH + Wormhole fee");

        uint256 amountToSend = msg.value - fee;

        (bool success,) = payable(recipient).call{value: amountToSend}("");
        require(success, "ETH transfer failed");

        uint256 amountGwei = amountToSend / 1e9;
        bytes memory payload = abi.encodePacked(
            intentId,
            bytes32(uint256(uint160(msg.sender))),
            bytes32(amountGwei)
        );

        sequence = wormhole.publishMessage{value: fee}(0, payload, consistencyLevel);
    }

    /// @notice EVM→{Sui,Solana,...} direction: Solver submits a Wormhole VAA proving
    ///         they paid on the destination chain, releasing locked ETH to solver.
    ///
    /// The VAA emitter must be registered via registerEmitter() for the source chain.
    ///
    /// Payload decoding (96 bytes):
    ///   [0..32]  orderId (bytes32)
    ///   [32..64] solver address (padded)
    ///   [64..96] amount paid on dest chain (uint256, last 8 bytes = u64 value)
    ///
    /// @param encodedVaa The signed Wormhole VAA bytes
    function settleOrder(bytes calldata encodedVaa) external {
        (IWormhole.VM memory vm, bool valid, string memory reason) =
            wormhole.parseAndVerifyVM(encodedVaa);
        require(valid, reason);

        // Verify the VAA came from a registered emitter on a registered chain
        bytes32 expectedEmitter = registeredEmitters[vm.emitterChainId];
        require(expectedEmitter != bytes32(0), "Unknown source chain");
        require(vm.emitterAddress == expectedEmitter, "Wrong emitter");

        // Replay protection: key by (emitterChainId, emitterAddress, sequence)
        // (vm.hash is unreliable due to the Signature[] field omitted in our IWormhole.VM)
        bytes32 vaaKey = keccak256(
            abi.encodePacked(vm.emitterChainId, vm.emitterAddress, vm.sequence)
        );
        require(!processedVaas[vaaKey], "VAA already processed");
        processedVaas[vaaKey] = true;

        require(vm.payload.length >= 96, "Invalid payload length");
        bytes32 orderId;
        bytes32 solverPadded;
        uint256 amountPaid;
        bytes memory payload = vm.payload;
        assembly {
            orderId     := mload(add(payload, 32))
            solverPadded := mload(add(payload, 64))
            amountPaid  := mload(add(payload, 96))
        }
        address solver = address(uint160(uint256(solverPadded)));

        Order storage order = orders[orderId];
        require(order.status == 0, "Order not active");
        require(block.timestamp <= order.deadline, "Order expired");
        // amountPaid (in dest-chain smallest unit) >= floorPrice confirms solver met the minimum
        require(amountPaid >= order.floorPrice, "Amount below floor price");

        // CEI: mark fulfilled before external call
        order.status = 1;

        (bool ok,) = payable(solver).call{value: order.amount}("");
        require(ok, "ETH payout failed");

        emit OrderFulfilled(orderId, solver);
    }
}
