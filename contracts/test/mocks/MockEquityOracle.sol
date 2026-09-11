// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IEquityOracle} from "../../src/interfaces/IEquityOracle.sol";

/// @dev Settable equity oracle for tests/testnet: price in WAD (USD/share) + publish time.
contract MockEquityOracle is IEquityOracle {
    mapping(bytes32 => uint256) public px; // WAD
    mapping(bytes32 => uint256) public ts; // updatedAt (unix seconds)

    function set(bytes32 id, uint256 priceWad, uint256 updatedAt) external {
        px[id] = priceWad;
        ts[id] = updatedAt;
    }

    function priceWad(bytes32 id) external view returns (uint256, uint256) {
        return (px[id], ts[id]);
    }
}
