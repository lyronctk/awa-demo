/*
 * Adapted from iden3/circomlib's javscript implementation of Poseidon. All
 * credit is due to iden3 for the original source.
 * Original source: circomlib/src/poseidonPerm.js. Our modification is to extend
 * the number of entries in N_ROUNDS_P, which allows Poseidon to hash more
 * values in one call.
 */
import assert from "assert";
import { Scalar, ZqField, utils } from "ffjavascript";
const { unstringifyBigInts } = utils;
import constants from "./node_modules/circomlib/src/poseidon_constants.json" assert { type: "json" };

// Prime 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
const F = new ZqField(
    Scalar.fromString(
        "21888242871839275222246405745257275088548364400416034343698204186575808495617"
    )
);

/*
 * Modified: altered require path for poseidon_constants.json.
 */
// Parameters are generated by a reference script https://extgit.iaik.tugraz.at/krypto/hadeshash/-/blob/master/code/generate_parameters_grain.sage
// Used like so: sage generate_parameters_grain.sage 1 0 254 2 8 56 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
const { C, M } = unstringifyBigInts(constants);

// Using recommended parameters from whitepaper https://eprint.iacr.org/2019/458.pdf (table 2, table 8)
// Generated by https://extgit.iaik.tugraz.at/krypto/hadeshash/-/blob/master/code/calc_round_numbers.py
// And rounded up to nearest integer that divides by t
const N_ROUNDS_F = 8;

/*
 * Modified: N_ROUNDS_P matches the value of N_ROUNDS_P in
 * circomlib/circuits/poseidon.circom.
 */
const N_ROUNDS_P = [
    56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68,
];

const pow5 = (a: BigInt) => F.mul(a, F.square(F.square(a, a)));

function poseidonPerm(inputs: BigInt[]) {
    assert(inputs.length > 0);
    assert(inputs.length < N_ROUNDS_P.length);

    const t = inputs.length;
    const nRoundsF = N_ROUNDS_F;
    const nRoundsP = N_ROUNDS_P[t - 2];

    let state = inputs.map((a) => F.e(a));
    for (let r = 0; r < nRoundsF + nRoundsP; r++) {
        state = state.map((a, i) => F.add(a, C[t - 2][r * t + i]));

        if (r < nRoundsF / 2 || r >= nRoundsF / 2 + nRoundsP) {
            state = state.map((a) => pow5(a));
        } else {
            state[0] = pow5(state[0]);
        }

        state = state.map((_, i) =>
            state.reduce(
                (acc, a, j) => F.add(acc, F.mul(M[t - 2][i][j], a)),
                F.zero
            )
        );
    }
    return state.map((x) => F.normalize(x));
}

export default poseidonPerm;
