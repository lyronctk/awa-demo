// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {Config} from "codegen/index.sol";
import {Groth16Proof} from "common/Groth16Proof.sol";
import {ISpawnVerifier} from "common/ISpawnVerifier.sol";
import {SpawnInputs} from "common/SpawnInputs.sol";

library LibSpawnVerify {
    function verifySpawnProof(
        SpawnInputs memory spawnInputs,
        Groth16Proof memory spawnProof
    ) internal view {
        ISpawnVerifier spawnVerifierContract = ISpawnVerifier(Config.getSpawnVerifierContract());
        require(
            spawnVerifierContract.verifyProof(
                spawnProof.a,
                spawnProof.b,
                spawnProof.c,
                _spawnInputsToArray(spawnInputs)
            ),
            "Invalid spawn proof"
        );
    }

    function _spawnInputsToArray(
        SpawnInputs memory spawnInputs
    ) internal pure returns (uint256[4] memory) {
        return [
            spawnInputs.spawnCityId,
            spawnInputs.commitBlockHash,
            spawnInputs.hUnownedTile,
            spawnInputs.hSpawnTile
        ];
    }
}
