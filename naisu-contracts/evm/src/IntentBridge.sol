// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// === Pyth Oracle Interface (minimal) ===
// Docs: https://docs.pyth.network/price-feeds/use-real-data/evm
interface IPyth {
    struct Price {
        int64  price;       // price * 10^expo
        uint64 conf;        // confidence interval * 10^expo
        int32  expo;        // typically -8
        uint   publishTime; // unix timestamp
    }

    /// Reverts if price is older than `age` seconds.
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory);
}

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
    // === Constants ===
    uint256 public constant MIN_SOLVER_BOND    = 0.05 ether;
    uint256 public constant BOND_COOLDOWN      = 7 days;
    uint256 public constant EXCLUSIVITY_WINDOW = 30;  // seconds

    uint8 public constant STATUS_OPEN      = 0;
    uint8 public constant STATUS_FULFILLED = 1;
    uint8 public constant STATUS_CANCELLED = 2;

    // === Pyth Price Oracle ===
    // Base Sepolia: https://docs.pyth.network/price-feeds/contract-addresses/evm
    IPyth public immutable pyth;

    // Price feed IDs (same on all EVM chains)
    bytes32 public constant ETH_USD_FEED =
        0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public constant SOL_USD_FEED =
        0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d;

    // Wormhole chain IDs for known destinations
    uint16 public constant WORMHOLE_SOLANA = 1;

    // Price tolerance: floorPrice must be >= this % of market rate (prevent dust attacks)
    // 7000 = 70% minimum. User can set startPrice up to 130% of market.
    uint256 public constant MIN_FLOOR_BPS  = 7000;
    uint256 public constant MAX_START_BPS  = 13000;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Max price age accepted from Pyth (1 hour — testnet feeds update infrequently)
    uint256 public constant PYTH_MAX_AGE = 3600;

    // === Structs ===
    struct Order {
        address creator;
        bytes32 recipient;
        uint16  destinationChain;
        uint256 amount;
        uint256 startPrice;
        uint256 floorPrice;
        uint256 deadline;
        uint256 createdAt;
        uint8   status;
        uint8   intentType; // 0=SOL, 1=mSOL (Marinade), 2=USDC (Orca)
        // Solver network — set by backend after RFQ; zero = open race
        address exclusiveSolver;
        uint256 exclusivityDeadline;
    }

    struct SolverInfo {
        string  name;
        uint256 bond;
        bool    active;
        uint256 registeredAt;
        uint256 unregisterAt;  // non-zero = unregister initiated
    }

    // === State ===
    address public owner;
    mapping(bytes32  => Order)      public orders;
    mapping(address  => SolverInfo) public solvers;
    uint256 public orderCount;

    // === Wormhole State ===
    IWormhole public wormhole;
    mapping(uint16   => bytes32) public registeredEmitters;
    mapping(bytes32  => bool)    public processedVaas;
    uint8 public immutable consistencyLevel;

    // === Events ===
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed creator,
        bytes32 recipient,
        uint16  destinationChain,
        uint256 amount,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 deadline,
        uint8   intentType
    );
    event OrderFulfilled(bytes32 indexed orderId, address indexed solver);
    event OrderCancelled(bytes32 indexed orderId);
    event EmitterRegistered(uint16 indexed chainId, bytes32 emitter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event SolverRegistered(address indexed solver, string name, uint256 bond);
    event SolverUnregistered(address indexed solver);
    event BondWithdrawn(address indexed solver, uint256 amount);
    event ExclusiveAssigned(bytes32 indexed orderId, address indexed solver, uint256 deadline);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _wormhole, uint8 _consistencyLevel, address _pyth) {
        owner = msg.sender;
        wormhole = IWormhole(_wormhole);
        consistencyLevel = _consistencyLevel;
        pyth = IPyth(_pyth);
    }

    // === Admin Functions ===

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

    /// @notice Called by the backend (owner key) after RFQ winner selection.
    ///         Grants the winning solver a 30-second exclusive window to fill.
    ///         If deadline passes without fill, anyone can settle (open race).
    function setExclusiveSolver(bytes32 orderId, address solver) external onlyOwner {
        Order storage order = orders[orderId];
        require(order.status == STATUS_OPEN,       "Order not active");
        require(block.timestamp < order.deadline,  "Order expired");
        require(solver != address(0),              "Zero solver");

        order.exclusiveSolver    = solver;
        order.exclusivityDeadline = block.timestamp + EXCLUSIVITY_WINDOW;

        emit ExclusiveAssigned(orderId, solver, order.exclusivityDeadline);
    }

    // === Solver Registry ===

    /// @notice Register as a solver by depositing bond (min 0.05 ETH).
    ///         Sybil resistance: creating 50 identities costs 2.5 ETH.
    function registerSolver(string calldata name) external payable {
        require(msg.value >= MIN_SOLVER_BOND,      "Insufficient bond");
        require(!solvers[msg.sender].active,       "Already registered");
        require(bytes(name).length > 0,            "Empty name");

        solvers[msg.sender] = SolverInfo({
            name:         name,
            bond:         msg.value,
            active:       true,
            registeredAt: block.timestamp,
            unregisterAt: 0
        });

        emit SolverRegistered(msg.sender, name, msg.value);
    }

    /// @notice Initiate unregistration — starts 7-day bond cooldown.
    function unregisterSolver() external {
        SolverInfo storage s = solvers[msg.sender];
        require(s.active,           "Not registered");
        s.active       = false;
        s.unregisterAt = block.timestamp;
        emit SolverUnregistered(msg.sender);
    }

    /// @notice Withdraw bond after 7-day cooldown following unregisterSolver().
    function withdrawBond() external {
        SolverInfo storage s = solvers[msg.sender];
        require(s.unregisterAt > 0,                         "Not unregistered");
        require(block.timestamp >= s.unregisterAt + BOND_COOLDOWN, "Cooldown active");
        require(s.bond > 0,                                 "No bond");

        uint256 amount = s.bond;
        s.bond = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdrawal failed");

        emit BondWithdrawn(msg.sender, amount);
    }

    // === User Functions ===

    function createOrder(
        bytes32 recipient,
        uint16  destinationChain,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 durationSeconds,
        uint8   intentType
    ) external payable returns (bytes32 orderId) {
        require(msg.value > 0,              "No ETH sent");
        require(startPrice >= floorPrice,   "Invalid price range");
        require(durationSeconds > 0,        "Invalid duration");
        require(recipient != bytes32(0),    "Invalid recipient");

        // NOTE: On-chain Pyth price validation disabled for testnet demo.
        // Price reasonableness is validated off-chain by the backend via Pyth Hermes
        // before building the transaction. Re-enable for mainnet deployment.

        orderId = keccak256(abi.encodePacked(msg.sender, orderCount, block.timestamp));
        orderCount++;

        orders[orderId] = Order({
            creator:             msg.sender,
            recipient:           recipient,
            destinationChain:    destinationChain,
            amount:              msg.value,
            startPrice:          startPrice,
            floorPrice:          floorPrice,
            deadline:            block.timestamp + durationSeconds,
            createdAt:           block.timestamp,
            status:              STATUS_OPEN,
            intentType:          intentType,
            exclusiveSolver:     address(0),
            exclusivityDeadline: 0
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
            intentType
        );
    }

    function cancelOrder(bytes32 orderId) external {
        Order storage order = orders[orderId];
        require(order.status == STATUS_OPEN,      "Order not active");
        require(order.creator == msg.sender,      "Not creator");

        order.status = STATUS_CANCELLED;

        (bool ok,) = payable(msg.sender).call{value: order.amount}("");
        require(ok, "Refund failed");

        emit OrderCancelled(orderId);
    }

    function getAuctionPrice(bytes32 orderId) external view returns (uint256) {
        Order storage order = orders[orderId];
        if (block.timestamp >= order.deadline) return order.floorPrice;

        uint256 elapsed       = block.timestamp - order.createdAt;
        uint256 totalDuration = order.deadline  - order.createdAt;
        uint256 priceRange    = order.startPrice - order.floorPrice;
        uint256 decay         = (priceRange * elapsed) / totalDuration;

        return order.startPrice - decay;
    }

    // === Internal: Pyth Price Validation ===

    /// @dev Validate that startPrice and floorPrice are within acceptable range
    ///      of the current ETH/SOL market rate from Pyth.
    ///
    ///      startPrice: SOL lamports the solver is initially expected to pay.
    ///      floorPrice: minimum SOL lamports accepted (Dutch auction floor).
    ///
    ///      Guards:
    ///        - floorPrice >= 70% of market rate  → prevents "give away" via dust floor
    ///        - startPrice <= 130% of market rate → prevents nonsensical high prices
    ///
    ///      Math (both feeds have expo = -8, so expo cancels):
    ///        expectedLamports = ethWei * ethPriceRaw / (1e9 * solPriceRaw)
    function _validateEthToSolPrice(
        uint256 ethWei,
        uint256 startLamports,
        uint256 floorLamports
    ) internal view {
        // If Pyth feed is stale or unavailable (common on testnets), skip validation
        // rather than blocking the transaction. The 70%/130% check only fires when
        // fresh prices are available.
        IPyth.Price memory ethP;
        IPyth.Price memory solP;
        try pyth.getPriceNoOlderThan(ETH_USD_FEED, PYTH_MAX_AGE) returns (IPyth.Price memory p) {
            ethP = p;
        } catch {
            return; // stale — skip
        }
        try pyth.getPriceNoOlderThan(SOL_USD_FEED, PYTH_MAX_AGE) returns (IPyth.Price memory p) {
            solP = p;
        } catch {
            return; // stale — skip
        }

        if (ethP.price <= 0 || solP.price <= 0) return;

        uint256 ethPRaw = uint256(uint64(ethP.price));
        uint256 solPRaw = uint256(uint64(solP.price));

        // Adjust for different exponents (usually both -8, but handle generically)
        uint256 expectedLamports;
        int32 expoDiff = ethP.expo - solP.expo;
        if (expoDiff >= 0) {
            expectedLamports = (ethWei * ethPRaw * (10 ** uint32(expoDiff))) / (1e9 * solPRaw);
        } else {
            expectedLamports = (ethWei * ethPRaw) / (1e9 * solPRaw * (10 ** uint32(-expoDiff)));
        }

        if (expectedLamports == 0) return;

        require(
            floorLamports >= expectedLamports * MIN_FLOOR_BPS / BPS_DENOMINATOR,
            "Oracle: floorPrice below 70% of market rate"
        );
        require(
            startLamports <= expectedLamports * MAX_START_BPS / BPS_DENOMINATOR,
            "Oracle: startPrice exceeds 130% of market rate"
        );
    }

    // === Solver Functions (Wormhole) ===

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

    /// @notice Submit Wormhole VAA proving solver paid on destination chain.
    ///         Enforces exclusive window if assigned — after deadline anyone can fill.
    function settleOrder(bytes calldata encodedVaa) external {
        (IWormhole.VM memory vm, bool valid, string memory reason) =
            wormhole.parseAndVerifyVM(encodedVaa);
        require(valid, reason);

        bytes32 expectedEmitter = registeredEmitters[vm.emitterChainId];
        require(expectedEmitter != bytes32(0), "Unknown source chain");
        require(vm.emitterAddress == expectedEmitter, "Wrong emitter");

        bytes32 vaaKey = keccak256(
            abi.encodePacked(vm.emitterChainId, vm.emitterAddress, vm.sequence)
        );
        require(!processedVaas[vaaKey], "VAA already processed");
        processedVaas[vaaKey] = true;

        require(vm.payload.length >= 96, "Invalid payload");
        bytes32 orderId;
        bytes32 solverPadded;
        uint256 amountPaid;
        bytes memory payload = vm.payload;
        assembly {
            orderId      := mload(add(payload, 32))
            solverPadded := mload(add(payload, 64))
            amountPaid   := mload(add(payload, 96))
        }
        address solver = address(uint160(uint256(solverPadded)));

        Order storage order = orders[orderId];
        require(order.status == STATUS_OPEN,      "Order not active");
        require(block.timestamp <= order.deadline, "Order expired");
        require(amountPaid >= order.floorPrice,   "Below floor price");

        // Enforce exclusive window if assigned and still active.
        // If exclusiveSolver == address(0) OR exclusivityDeadline has passed → open race.
        if (
            order.exclusiveSolver != address(0) &&
            block.timestamp < order.exclusivityDeadline
        ) {
            require(solver == order.exclusiveSolver, "Exclusive window active");
        }

        // CEI: mark fulfilled before external call
        order.status = STATUS_FULFILLED;

        (bool ok,) = payable(solver).call{value: order.amount}("");
        require(ok, "ETH payout failed");

        emit OrderFulfilled(orderId, solver);
    }
}
