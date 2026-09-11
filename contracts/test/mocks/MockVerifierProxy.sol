// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVerifierProxy} from "../../src/interfaces/IVerifierProxy.sol";

/// @dev Stand-in for the Chainlink Data Streams VerifierProxy. The real one checks DON signatures on
///      `payload` (abi.encode(bytes32[3] reportContext, bytes reportData)) and returns the verified
///      `reportData`. This mock skips signature checking and just returns the reportData, so a test
///      can drive a consumer with any report body it encodes. Subscription billing = no fee, empty
///      parameterPayload — mirrored here (payable, ignores the second arg).
contract MockVerifierProxy is IVerifierProxy {
    function verify(bytes calldata payload, bytes calldata) external payable returns (bytes memory) {
        (, bytes memory reportData) = abi.decode(payload, (bytes32[3], bytes));
        return reportData;
    }
}
