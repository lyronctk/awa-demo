const { wasm } = require("circom_tester");
import { assert } from "chai";
import { Player, Tile, Board, Location, Utils } from "../../game";

describe("Unit tests for CheckNullifiers()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_nullifiers.circom");
    });

    it("fails if either of the nullifiers are invalid", async () => {
        const t1 = Tile.genUnowned({ r: 0, c: 0 });
        const t2 = Tile.genUnowned({ r: 0, c: 1 });

        const w1 = await circuit.calculateWitness(
            {
                keyFrom: t1.key.toString(),
                keyTo: t2.key.toString(),
                rhoFrom: t1.nullifier(),
                rhoTo: "123",
            },
            true
        );
        // circom witness gen places circuit outputs at indices [1, n_outputs]
        assert.equal(w1[1], BigInt("0"));
        await circuit.checkConstraints(w1);

        const w2 = await circuit.calculateWitness(
            {
                keyFrom: t1.key.toString(),
                keyTo: t2.key.toString(),
                rhoFrom: t1.nullifier(),
                rhoTo: "123",
            },
            true
        );
        assert.equal(w2[1], BigInt("0"));
        await circuit.checkConstraints(w2);
    });

    it("passes if both nullifiers are valid", async () => {
        const t1 = Tile.genUnowned({ r: 0, c: 0 });
        const t2 = Tile.genUnowned({ r: 0, c: 1 });

        const w = await circuit.calculateWitness(
            {
                keyFrom: t1.key.toString(),
                keyTo: t2.key.toString(),
                rhoFrom: t1.nullifier(),
                rhoTo: t2.nullifier(),
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckLeaves()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_leaves.circom");
    });

    it("fails if player tries to move troops they don't own", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(p1, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);
        const t2 = Tile.genOwned(p1, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);

        const w = await circuit.calculateWitness(
            {
                uFrom: t1.toCircuitInput(),
                uTo: t2.toCircuitInput(),
                hUFrom: t1.hash(),
                hUTo: t2.hash(),
                privKeyHash: p2.bjjPrivHash,
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if proposed hashes don't match the new", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(p1, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);
        const t2 = Tile.genOwned(p2, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);

        const w1 = await circuit.calculateWitness(
            {
                uFrom: t1.toCircuitInput(),
                uTo: t2.toCircuitInput(),
                hUFrom: "123",
                hUTo: t2.hash(),
                privKeyHash: p2.bjjPrivHash,
            },
            true
        );
        assert.equal(w1[1], BigInt("0"));
        await circuit.checkConstraints(w1);

        const w2 = await circuit.calculateWitness(
            {
                uFrom: t1.toCircuitInput(),
                uTo: t2.toCircuitInput(),
                hUFrom: t1.hash(),
                hUTo: "123",
                privKeyHash: p2.bjjPrivHash,
            },
            true
        );
        assert.equal(w2[1], BigInt("0"));
        await circuit.checkConstraints(w2);
    });

    it("passes if move initiated by owner & new hashes valid", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(p1, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);
        const t2 = Tile.genOwned(p2, { r: 0, c: 0 }, 9, 0, 0, Tile.NORMAL_TILE);

        const w = await circuit.calculateWitness(
            {
                uFrom: t1.toCircuitInput(),
                uTo: t2.toCircuitInput(),
                hUFrom: t1.hash(),
                hUTo: t2.hash(),
                privKeyHash: p1.bjjPrivHash,
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckStep()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_step.circom");
    });

    it("fails if player tries to move diagonally", async () => {
        const t1 = Tile.genUnowned({ r: 0, c: 0 });
        const t2 = Tile.genUnowned({ r: 1, c: 1 });

        const u1 = Tile.genUnowned({ r: 0, c: 0 });
        const u2 = Tile.genUnowned({ r: 1, c: 1 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player swaps locations during update", async () => {
        const t1 = Tile.genUnowned({ r: 81, c: 30 });
        const t2 = Tile.genUnowned({ r: 81, c: 29 });

        const u1 = Tile.genUnowned({ r: 5, c: 5 });
        const u2 = Tile.genUnowned({ r: 81, c: 29 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player tries to move in place", async () => {
        const t1 = Tile.genUnowned({ r: 0, c: 0 });
        const t2 = Tile.genUnowned({ r: 0, c: 0 });

        const u1 = Tile.genUnowned({ r: 0, c: 0 });
        const u2 = Tile.genUnowned({ r: 0, c: 0 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player tries to change tile type", async () => {
        const t1 = Tile.genUnowned({ r: 12, c: 15 });
        const t2 = Tile.water({ r: 11, c: 15 });

        const u1 = Tile.genUnowned({ r: 12, c: 15 });
        const u2 = Tile.genUnowned({ r: 11, c: 15 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player tries to move onto a hill tile", async () => {
        const t1 = Tile.genUnowned({ r: 12, c: 15 });
        const t2 = Tile.hill({ r: 11, c: 15 });

        const u1 = Tile.genUnowned({ r: 12, c: 15 });
        const u2 = Tile.genUnowned({ r: 11, c: 15 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("passes if state updated in unit cardinal plane", async () => {
        const t1 = Tile.genUnowned({ r: 12, c: 15 });
        const t2 = Tile.genUnowned({ r: 11, c: 15 });

        const u1 = Tile.genUnowned({ r: 12, c: 15 });
        const u2 = Tile.genUnowned({ r: 11, c: 15 });

        const w = await circuit.calculateWitness(
            {
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckRsrc()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_rsrc.circom");
    });

    it("fails if player moves all troops out of a tile", async () => {
        const p = new Player("A", BigInt("0xfff"));
        const t1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            9,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genUnowned({ r: 124, c: 321 });
        const u1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            0,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p,
            { r: 124, c: 321 },
            9,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "9",
                toUpdatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player invents troops out of thin air, case 1", async () => {
        const p = new Player("A", BigInt("0xfff"));
        const t1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            3,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genUnowned({ r: 124, c: 321 });
        const u1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            3,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p,
            { r: 124, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "3",
                toUpdatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player invents troops out of thin air, case 2", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            9,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            3,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            1,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p1,
            { r: 124, c: 321 },
            11,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "9",
                toUpdatedTroops: "3",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player claims to capture with fewer resources", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            3,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            9,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            1,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p1,
            { r: 124, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "3",
                toUpdatedTroops: "9",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player doesn't capture unowned tile when they should", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            5,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genUnowned({ r: 124, c: 321 });
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genUnowned({ r: 124, c: 321 });

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "5",
                toUpdatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player doesn't capture enemy tile when they should", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            5,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            1,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "5",
                toUpdatedTroops: "2",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("passes if resource management rules hold, taking unowned", async () => {
        const p = new Player("A", BigInt("0xfff"));
        const t1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            9,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genUnowned({ r: 124, c: 321 });
        const u1 = Tile.genOwned(
            p,
            { r: 123, c: 321 },
            2,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p,
            { r: 124, c: 321 },
            7,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "9",
                toUpdatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("passes if resource management rules hold, battling enemy", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            15,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            33,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            28,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "15",
                toUpdatedTroops: "33",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("passes if resource management rules hold, taking enemy", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            33,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            15,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            3,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p1,
            { r: 124, c: 321 },
            15,
            0,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "0",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "33",
                toUpdatedTroops: "15",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("passes if player can capture enemy because of a troop update", async () => {
        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            30,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            30,
            2,
            0,
            Tile.NORMAL_TILE
        );
        const u1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            1,
            2,
            0,
            Tile.NORMAL_TILE
        );
        const u2 = Tile.genOwned(
            p1,
            { r: 124, c: 321 },
            1,
            2,
            0,
            Tile.NORMAL_TILE
        );

        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "2",
                currentWaterInterval: "0",
                tFrom: t1.toCircuitInput(),
                tTo: t2.toCircuitInput(),
                uFrom: u1.toCircuitInput(),
                uTo: u2.toCircuitInput(),
                fromUpdatedTroops: "32",
                toUpdatedTroops: "30",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckTroopUpdates()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_trp_updates.circom");
    });

    it("fails if player adds troops when they do not deserve to", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "1",
                tTroops: "10",
                isSelfOrEnemy: "1",
                tLatestUpdate: "1",
                uLatestUpdate: "1",
                updatedTroops: "20",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player does not add more troops during a troop updates", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "10",
                isSelfOrEnemy: "1",
                tLatestUpdate: "1",
                uLatestUpdate: "5",
                updatedTroops: "10",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player does not update their latest troop update interval", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "10",
                isSelfOrEnemy: "1",
                tLatestUpdate: "1",
                uLatestUpdate: "1",
                updatedTroops: "14",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player only updates their troops partway", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "10",
                isSelfOrEnemy: "1",
                tLatestUpdate: "1",
                uLatestUpdate: "5",
                updatedTroops: "11",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if unowned tile gets troops", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "0",
                isSelfOrEnemy: "0",
                tLatestUpdate: "1",
                uLatestUpdate: "5",
                updatedTroops: "4",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("passes if player gains the correct number of troops after troop update", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "10",
                isSelfOrEnemy: "1",
                tLatestUpdate: "1",
                uLatestUpdate: "5",
                updatedTroops: "14",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("passes if unowned tile gets no troops", async () => {
        const w = await circuit.calculateWitness(
            {
                currentTroopInterval: "5",
                tTroops: "0",
                isSelfOrEnemy: "0",
                tLatestUpdate: "1",
                uLatestUpdate: "5",
                updatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckWaterUpdates()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_water.circom");
    });

    it("fails if player does not lose troops in water", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "10",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "10",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player loses too few troops in water", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "10",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "6",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player loses too many troops in water", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "10",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "4",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if player gains troops in water", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "10",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "15",
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("passes if player loses correct amount of troops in water", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "10",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "5",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("passes if unowned water tile is unaffected by update", async () => {
        const w = await circuit.calculateWitness(
            {
                currentWaterInterval: "10",
                tTroops: "0",
                tLatestUpdate: "5",
                uLatestUpdate: "10",
                updatedTroops: "0",
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });
});

describe("Unit tests for CheckMerkleInclusion()", () => {
    let circuit;

    beforeEach(async () => {
        circuit = await wasm("test/circuits/test_check_merkle.circom");
    });

    it("passes if both tiles are in the merkle root", async () => {
        let tree = Utils.newTree(8);

        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );

        tree.insert(Utils.intoBigNumber(t1.hash()));
        tree.insert(Utils.intoBigNumber(t2.hash()));

        const mp1 = Utils.generateMerkleProof(t1.hash(), tree);
        const mp2 = Utils.generateMerkleProof(t2.hash(), tree);

        const w = await circuit.calculateWitness(
            {
                root: tree.root,
                tFrom: t1.toCircuitInput(),
                tFromPathIndices: mp1.indices,
                tFromPathElements: mp1.pathElements,
                tTo: t2.toCircuitInput(),
                tToPathIndices: mp2.indices,
                tToPathElements: mp2.pathElements,
            },
            true
        );
        assert.equal(w[1], BigInt("1"));
        await circuit.checkConstraints(w);
    });

    it("fails if the from tile is not in the merkle root", async () => {
        let tree = Utils.newTree(8);

        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );

        tree.insert(Utils.intoBigNumber(t1.hash()));

        const mp1 = Utils.generateMerkleProof(t1.hash(), tree);
        const mp2 = mp1; // Can't generate a valid proof for t2, so we try mp1

        const w = await circuit.calculateWitness(
            {
                root: tree.root,
                tFrom: t1.toCircuitInput(),
                tFromPathIndices: mp1.indices,
                tFromPathElements: mp1.pathElements,
                tTo: t2.toCircuitInput(),
                tToPathIndices: mp2.indices,
                tToPathElements: mp2.pathElements,
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });

    it("fails if the to tile is not in the merkle root", async () => {
        let tree = Utils.newTree(8);

        const p1 = new Player("A", BigInt("0xfff"));
        const p2 = new Player("B", BigInt("0xddd"));
        const t1 = Tile.genOwned(
            p1,
            { r: 123, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );
        const t2 = Tile.genOwned(
            p2,
            { r: 124, c: 321 },
            10,
            0,
            0,
            Tile.NORMAL_TILE
        );

        tree.insert(Utils.intoBigNumber(t1.hash()));

        const mp1 = Utils.generateMerkleProof(t1.hash(), tree);
        const mp2 = mp1;

        const w = await circuit.calculateWitness(
            {
                root: tree.root,
                tFrom: t1.toCircuitInput(),
                tFromPathIndices: mp2.indices,
                tFromPathElements: mp2.pathElements,
                tTo: t2.toCircuitInput(),
                tToPathIndices: mp1.indices,
                tToPathElements: mp1.pathElements,
            },
            true
        );
        assert.equal(w[1], BigInt("0"));
        await circuit.checkConstraints(w);
    });
});