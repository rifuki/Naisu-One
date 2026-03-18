// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockPyth
/// @notice Minimal Pyth oracle mock for testing. Returns configurable prices.
contract MockPyth {
    struct Price {
        int64  price;
        uint64 conf;
        int32  expo;
        uint   publishTime;
    }

    mapping(bytes32 => Price) private _prices;
    uint private _maxAge;

    constructor(uint maxAge) {
        _maxAge = maxAge;
    }

    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo) external {
        _prices[id] = Price({ price: price, conf: conf, expo: expo, publishTime: block.timestamp });
    }

    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory) {
        Price memory p = _prices[id];
        require(p.price > 0, "MockPyth: price not set");
        require(block.timestamp - p.publishTime <= age, "MockPyth: price too stale");
        return p;
    }
}
