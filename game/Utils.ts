// @ts-ignore
import { ethers } from "ethers";
import { groth16 } from "snarkjs";
import { Signature } from "maci-crypto";
import crypto from "crypto";
import { BigNumber } from "ethers";
import { Tile, Location } from "./Tile";
/*
 * poseidonPerm is a modified version of iden3's poseidonPerm.js.
 */
import poseidonPerm from "../game/poseidonPerm.js";

export type Groth16Proof = {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
};

export type Groth16ProofCalldata = {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    input: string[];
};

export enum Terrain {
    BARE,
    WATER,
    HILL,
    BONUS_TROOPS,
}

export type TerrainGenerator = (location: Location) => Terrain;

export const dummyTerrainGenerator = (location: Location) => {
    const { r: i, c: j } = location;
    if (i === 0 && j === 1) {
        return Terrain.HILL;
    } else if (i === 1 && j === 1) {
        return Terrain.WATER;
    } else {
        return Terrain.BARE;
    }
};

export class Utils {
    /*
     * Stringify a location object. Converts BigInt values to strings.
     */
    static stringifyLocation(location: Location): string {
        return JSON.stringify({
            r: location.r.toString(),
            c: location.c.toString(),
        });
    }

    /*
     * Unstringify a location object. Converts string values back to BigInt.
     * Returns undefined if the input is not valid.
     */
    static unstringifyLocation(locationString: string): Location | undefined {
        try {
            const location = JSON.parse(locationString);
            return {
                r: Number(location.r),
                c: Number(location.c),
            };
        } catch (error) {
            console.error("Error while unstringifying location:", error);
            return undefined;
        }
    }

    /*
     * Call `await` on the return value of this function to block.
     */
    static sleep(milliseconds: number) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    /*
     * Serialize a MACI signature.
     */
    static serializeSig(sig: Signature): string {
        return JSON.stringify({
            R8: sig.R8.map((bigIntValue) => bigIntValue.toString()),
            S: sig.S.toString(),
        });
    }

    /*
     * Unserialize a MACI signature.
     */
    static unserializeSig(serializedSignature: string): Signature | null {
        try {
            const parsed = JSON.parse(serializedSignature);
            return {
                R8: [BigInt(parsed["R8"][0]), BigInt(parsed["R8"][1])],
                S: BigInt(parsed["S"]),
            };
        } catch (error) {
            console.error("Error while unserializing signature:", error);
            return null;
        }
    }

    /*
     * Converts an ASCII string into its BigInt representation. Used to sign
     * the client's socket ID.
     */
    static asciiIntoBigNumber(msg: string): bigint {
        let result = BigInt(0);
        for (let i = 0; i < msg.length; i++) {
            result = (result << BigInt(8)) + BigInt(msg.charCodeAt(i));
        }
        return result;
    }

    /*
     * Wrapper for poseidonPerm, which is a modified version of iden3's
     * poseidonPerm.js.
     */
    static poseidonExt(inputs: bigint[]) {
        return poseidonPerm([0n, ...inputs])[0];
    }

    /*
     * Wrapper for turning string into type compatible with IncrementalQuinTree.
     */
    static hIntoBigNumber(hash: string): BigNumber {
        return BigNumber.from(hash);
    }

    /*
     * Formats a proof into what is expected by the solidity verifier.
     * Inspired by https://github.com/vplasencia/zkSudoku/blob/main/contracts/test/utils/utils.js
     */
    static async exportCallDataGroth16(
        prf: Groth16Proof,
        pubSigs: any
    ): Promise<Groth16ProofCalldata> {
        const proofCalldata: string = await groth16.exportSolidityCallData(
            prf,
            pubSigs
        );
        const argv: string[] = proofCalldata
            .replace(/["[\]\s]/g, "")
            .split(",")
            .map((x: string) => BigInt(x).toString());
        return {
            a: argv.slice(0, 2) as [string, string],
            b: [
                argv.slice(2, 4) as [string, string],
                argv.slice(4, 6) as [string, string],
            ],
            c: argv.slice(6, 8) as [string, string],
            input: argv.slice(8),
        };
    }

    static unpackMoveInputs(
        formattedProof: Groth16ProofCalldata,
        sig: string,
        b: number
    ) {
        const moveInputs = {
            fromIsCityCenter: formattedProof.input[6] === "1",
            toIsCityCenter: formattedProof.input[7] === "1",
            fromIsWaterTile: formattedProof.input[8] === "1",
            toIsWaterTile: formattedProof.input[9] === "1",
            takingCity: formattedProof.input[10] === "1",
            ontoSelfOrUnowned: formattedProof.input[3] === "1",
            fromCityId: Number(formattedProof.input[1]),
            toCityId: Number(formattedProof.input[2]),
            fromCityTroops: Number(formattedProof.input[11]),
            toCityTroops: Number(formattedProof.input[12]),
            numTroopsMoved: Number(formattedProof.input[4]),
            enemyLoss: Number(formattedProof.input[5]),
            currentInterval: formattedProof.input[0],
            hTFrom: formattedProof.input[13],
            hTTo: formattedProof.input[14],
            hUFrom: formattedProof.input[15],
            hUTo: formattedProof.input[16],
        };
        const moveProof = {
            a: formattedProof.a,
            b: formattedProof.b,
            c: formattedProof.c,
        };
        const unpackedSig = ethers.utils.splitSignature(sig);
        const moveSig = {
            v: unpackedSig.v,
            r: unpackedSig.r,
            s: unpackedSig.s,
            b,
        };

        return [moveInputs, moveProof, moveSig];
    }

    static unpackVirtualInputs(formattedProof: Groth16ProofCalldata) {
        const virtualInputs = {
            hRand: formattedProof.input[0],
            hVirt: formattedProof.input[1],
        };
        const virtualProof = {
            a: formattedProof.a,
            b: formattedProof.b,
            c: formattedProof.c,
        };

        return [virtualInputs, virtualProof];
    }

    static unpackSpawnInputs(
        formattedProof: Groth16ProofCalldata,
        sig: string
    ) {
        const spawnInputs = {
            canSpawn: formattedProof.input[0] === "1",
            spawnCityId: Number(formattedProof.input[1]),
            hPrevTile: formattedProof.input[2],
            hSpawnTile: formattedProof.input[3],
            hBlindLoc: formattedProof.input[4],
        };
        const spawnProof = {
            a: formattedProof.a,
            b: formattedProof.b,
            c: formattedProof.c,
        };
        const unpackedSig = ethers.utils.splitSignature(sig);
        const spawnSig = {
            v: unpackedSig.v,
            r: unpackedSig.r,
            s: unpackedSig.s,
            b: 0,
        };

        return [spawnInputs, spawnProof, spawnSig];
    }

    /*
     * Returns a randomly generated AES-256 private key.
     */
    static genAESEncKey(): Buffer {
        return crypto.randomBytes(32);
    }

    /*
     * Encrypt tile data with AES-256-GCM cipher. Returns the ciphertext, along
     * with the IV used and the authTag.
     */
    static encryptTile(encKey: Buffer, tile: Tile) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
        return {
            ciphertext: Buffer.concat([
                cipher.update(JSON.stringify(tile.toJSON())),
                cipher.final(),
            ]).toString("hex"),
            iv: iv.toString("hex"),
            tag: cipher.getAuthTag().toString("hex"),
        };
    }

    /*
     * Decrypts ciphertext outputted by encryptTile back into a Tile object.
     */
    static decryptTile(
        decKey: Buffer,
        ciphertext: string,
        iv: string,
        tag: string
    ): Tile {
        const ivBuffer = Buffer.from(iv, "hex");
        let decipher = crypto.createDecipheriv("aes-256-gcm", decKey, ivBuffer);
        decipher.setAuthTag(Buffer.from(tag, "hex"));

        const tileString = Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "hex")),
            decipher.final(),
        ]).toString();

        return Tile.fromJSON(JSON.parse(tileString));
    }
}
