// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVerifierProxy
/// @notice Minimal slice of the Chainlink Data Streams VerifierProxy. `verify` checks the DON
///         signatures on a fetched report payload and returns the verified report bytes, which the
///         caller then abi.decodes into the schema struct (v11 RWA Advanced for US equities). Data
///         Streams uses subscription billing, so `parameterPayload` is empty (`""`) and no LINK
///         approval or per-call fee is required.
interface IVerifierProxy {
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);
}
