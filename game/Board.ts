// @ts-ignore
import { groth16 } from "snarkjs";
import { Groth16Proof, Utils } from "./Utils";
import { Player } from "./Player";
import { Tile, Location } from "./Tile";

export class Board {
    static MOVE_WASM: string = "../circuits/move/move.wasm";
    static MOVE_PROVKEY: string = "../circuits/move/move.zkey";
    static PERIMETER: number[][] = [-1, 0, 1].flatMap((x) =>
        [-1, 0, 1].map((y) => [x, y])
    );

    t: Tile[][];

    playerCapital: Map<string, number>;
    playerCities: Map<string, Set<number>>;
    cityTiles: Map<number, Set<string>>;

    public constructor() {
        this.t = new Array<Array<Tile>>();

        this.playerCapital = new Map<string, number>();
        this.playerCities = new Map<string, Set<number>>();
        this.cityTiles = new Map<number, Set<string>>();
    }

    /*
     * Seed game board by sampling access key for each tile, updating on-chain
     * hashes along the way. Doesn't do any sampling if isInit flag is off.
     * With that setting, it only initializes board with mystery tiles.
     */
    public async seed(sz: number, isInit: boolean, nStates: any) {
        for (let i = 0; i < sz; i++) {
            let row: Tile[] = new Array<Tile>();
            for (let j = 0; j < sz; j++) {
                if (isInit) {
                    let tl = Tile.genUnowned({ r: i, c: j });
                    if (nStates) {
                        await nStates.set(tl.hash());
                    }
                    row.push(tl);
                } else {
                    row.push(Tile.mystery({ r: i, c: j }));
                }
            }
            this.t.push(row);
        }
    }

    /*
     * Check if a location = (row, col) pair is within the bounds of the board.
     */
    public inBounds(r: number, c: number): boolean {
        return r < this.t.length && r >= 0 && c < this.t[0].length && c >= 0;
    }

    /*
     * Throws an error if a presented location isn't in bounds.
     */
    private assertBounds(l: Location) {
        if (!this.inBounds(l.r, l.c)) {
            throw new Error("Tried to edit tile out of bounds.");
        }
    }

    /*
     * Spawn Player at a Location. Used for development. Enclave only func.
     */
    public async spawn(
        l: Location,
        pl: Player,
        resource: number,
        cityId: number,
        nStates: any
    ) {
        this.assertBounds(l);

        let r = l.r,
            c = l.c;
        if (!this.t[r][c].isUnowned()) {
            throw new Error("Tried to spawn player on an owned tile.");
        }

        const tl = Tile.genOwned(
            pl,
            { r, c },
            resource,
            cityId,
            0,
            Tile.CAPITAL_TILE
        );

        this.setTile(tl);

        this.playerCapital.set(pl.address, cityId);
        this.playerCities.set(pl.address, new Set<number>().add(cityId));
        this.cityTiles.set(
            cityId,
            new Set<string>().add(JSON.stringify({ r, c }))
        );

        // Update the global state on-chain.
        if (nStates) {
            await nStates.spawn(pl.address, cityId, this.t[r][c].hash());
        }
    }

    /*
     * Does the player have a capital? Enclave function.
     */
    public isSpawned(pl: Player): boolean {
        return this.playerCapital.has(pl.address);
    }

    /*
     * Displays colored gameboard. Local belief of what the gameboard is from
     * the perspective of the client.
     */
    public printView(): void {
        for (let i = 0; i < this.t.length; i++) {
            for (let j = 0; j < this.t[0].length; j++) {
                let tl: Tile = this.getTile({ r: i, c: j });
                let color;
                const reset = "\x1b[0m";
                if (tl.tileType === Tile.WATER_TILE) {
                    color = "\x1b[36m";
                } else if (tl.tileType === Tile.HILL_TILE) {
                    color = "\x1b[90m";
                } else if (tl.owner.symbol === "A") {
                    color = "\x1b[32m";
                } else if (tl.owner.symbol === "B") {
                    color = "\x1b[31m";
                } else if (tl.owner.symbol === "C") {
                    color = "\x1b[44m";
                } else {
                    color = "\x1b[37m";
                }
                process.stdout.write(color + `[${tl.owner.symbol}]` + reset);
            }
            process.stdout.write("\n");
        }
        process.stdout.write("---\n");
    }

    /*
     * Getter for Tile at a location.
     */
    public getTile(l: Location): Tile {
        this.assertBounds(l);
        return this.t[l.r][l.c];
    }

    public getNearbyLocations(l: Location): Location[] {
        let locs: Location[] = [];
        for (let r = l.r - 1; r <= l.r + 1; r++) {
            for (let c = l.c - 1; c <= l.c + 1; c++) {
                if (this.inBounds(r, c)) {
                    locs.push({ r, c });
                }
            }
        }
        return locs;
    }

    /*
     * Set location to new Tile value. Enclave-only func.
     */
    public setTile(tl: Tile) {
        const oldTile = this.t[tl.loc.r][tl.loc.c];
        const oldOwner = oldTile.owner.address;
        const newOwner = tl.owner.address;

        if (oldOwner !== newOwner) {
            // Some type of capture happened: must update state
            if (oldTile.isCapital()) {
                this.playerCapital.delete(oldOwner);

                for (let cityId of this.playerCities.get(oldOwner)!) {
                    // Change tiles' ownership
                    for (let locString of this.cityTiles.get(cityId)!) {
                        const loc = JSON.parse(locString);
                        if (loc) {
                            let tile = this.t[loc.r][loc.c];
                            tile.owner = tl.owner;
                            this.t[loc.r][loc.c] = tile;
                        }
                    }

                    this.playerCities.get(newOwner)?.add(cityId);
                }
                this.playerCities.delete(oldOwner);
            } else if (oldTile.isCity()) {
                // Change tiles' ownership
                for (let locString of this.cityTiles.get(oldTile.cityId)!) {
                    const loc = JSON.parse(locString);
                    if (loc) {
                        let tile = this.t[loc.r][loc.c];
                        tile.owner = oldTile.owner;
                        this.t[loc.r][loc.c] = tile;
                    }
                }

                this.playerCities.get(oldOwner)?.delete(tl.cityId);
                this.playerCities.get(newOwner)?.add(tl.cityId);
            } else {
                // Normal/water tile with a new owner
                const locString = JSON.stringify(tl.loc);
                this.cityTiles.get(oldTile.cityId)?.delete(locString);
                this.cityTiles.get(tl.cityId)?.add(locString);
            }
        }

        this.t[tl.loc.r][tl.loc.c] = tl;
    }

    /*
     * Check if a location is NOT in the FoW for requesting player. Enclave-only
     * func.
     */
    public noFog(l: Location, reqPlayer: Player): boolean {
        let r = l.r,
            c = l.c;
        let foundNeighbor = false;
        Board.PERIMETER.forEach(([dy, dx]) => {
            let nr = r + dy,
                nc = c + dx;
            if (
                this.inBounds(nr, nc) &&
                this.playerCities
                    .get(reqPlayer.address)
                    ?.has(this.t[nr][nc].cityId)
            ) {
                foundNeighbor = true;
            }
        });
        return foundNeighbor;
    }

    /*
     * Returns true if every Tile in this board instance is a Mystery. Only
     * happens when not player isn't spawned yet.
     */
    public noVisibility() {
        for (let i = 0; i < this.t.length; i++) {
            for (let j = 0; j < this.t[0].length; j++) {
                const tl: Tile = this.getTile({ r: i, c: j });
                if (!tl.isMystery()) {
                    return false;
                }
            }
        }
        return true;
    }

    /*
     * Computes the number of troops on tile after considering troop/water
     * updates.
     */
    static computeUpdatedTroops(
        tTile: Tile,
        cityTroops: number,
        currentWaterInterval: number
    ): number {
        if (tTile.isWater()) {
            const deltaTroops =
                tTile.latestUpdateInterval - currentWaterInterval;
            return Math.max(tTile.resources + deltaTroops, 0);
        } else if (tTile.isCity() || tTile.isCapital()) {
            return cityTroops;
        }

        return tTile.resources;
    }

    /*
     * Computes proper state of tile an army is about to move onto. Goes through
     * game logic of what happens during a battle.
     */
    static computeOntoTile(
        tTo: Tile,
        tFrom: Tile,
        uFrom: Tile,
        updatedTroops: number,
        nMobilize: number,
        currentWaterInterval: number
    ): Tile {
        if (nMobilize < 1) {
            throw Error("Cannot move without mobilizing at least 1 troop.");
        }
        let uTo: Tile;
        if (tTo.owner.address === tFrom.owner.address) {
            uTo = Tile.genOwned(
                tTo.owner,
                tTo.loc,
                updatedTroops + nMobilize,
                tTo.cityId,
                currentWaterInterval,
                tTo.tileType
            );
        } else if (tTo.isUnowned()) {
            uTo = Tile.genOwned(
                tFrom.owner,
                tTo.loc,
                nMobilize,
                tFrom.cityId,
                currentWaterInterval,
                tTo.tileType
            );
        } else {
            uTo = Tile.genOwned(
                tTo.owner,
                tTo.loc,
                updatedTroops - nMobilize,
                tTo.cityId,
                currentWaterInterval,
                tTo.tileType
            );
            if (uTo.resources < 0) {
                uTo.owner = uFrom.owner;
                uTo.resources *= -1;
                if (
                    tTo.tileType != Tile.CITY_TILE &&
                    tTo.tileType != Tile.CAPITAL_TILE
                ) {
                    uTo.cityId = uFrom.cityId;
                } else if (tTo.tileType === Tile.CAPITAL_TILE) {
                    uTo.tileType = Tile.CITY_TILE;
                }
            }
        }
        return uTo;
    }

    /*
     * Generates state transition, nullifier combo, and ZKP needed to move
     * troops from one tile to another. Moves all but one troop for development.
     */
    public async constructMove(
        from: Location,
        to: Location,
        nStates: any
    ): Promise<[Tile, Tile, Tile, Tile, Groth16Proof, any]> {
        const tFrom: Tile = this.getTile(from);
        const tTo: Tile = this.getTile(to);

        const currentWaterInterval = (
            await nStates.getCurrentInterval()
        ).toNumber();
        const fromCityTroops = await nStates.getCityCenterTroops(tFrom.cityId);
        const toCityTroops = await nStates.getCityCenterTroops(tTo.cityId);

        // Most recent troop counts
        const fromUpdatedTroops = Board.computeUpdatedTroops(
            tFrom,
            fromCityTroops,
            currentWaterInterval
        );
        const toUpdatedTroops = Board.computeUpdatedTroops(
            tTo,
            toCityTroops,
            currentWaterInterval
        );

        const nMobilize = fromUpdatedTroops - 1;

        const uFrom: Tile = Tile.genOwned(
            tFrom.owner,
            tFrom.loc,
            fromUpdatedTroops - nMobilize,
            tFrom.cityId,
            currentWaterInterval,
            tFrom.tileType
        );
        const uTo: Tile = Board.computeOntoTile(
            tTo,
            tFrom,
            uFrom,
            toUpdatedTroops,
            nMobilize,
            currentWaterInterval
        );

        const enemyLoss = Math.min(toUpdatedTroops, nMobilize);
        const ontoSelfOrUnowned =
            tTo.owner.address === tFrom.owner.address || tTo.isUnowned()
                ? "1"
                : "0";
        const capturedTile = uTo.owner.address != tTo.owner.address;
        const takingCity = tTo.isCity() && capturedTile ? "1" : "0";
        const takingCapital = tTo.isCapital() && capturedTile ? "1" : "0";

        const { proof, publicSignals } = await groth16.fullProve(
            {
                currentWaterInterval: currentWaterInterval.toString(),
                fromCityId: tFrom.cityId.toString(),
                toCityId: tTo.cityId.toString(),
                ontoSelfOrUnowned,
                numTroopsMoved: nMobilize.toString(),
                enemyLoss: enemyLoss.toString(),
                fromIsCityTile: tFrom.isCity() || tFrom.isCapital() ? "1" : "0",
                toIsCityTile: tTo.isCity() || tTo.isCapital() ? "1" : "0",
                takingCity,
                takingCapital,
                fromCityTroops: fromCityTroops.toString(),
                toCityTroops: toCityTroops.toString(),
                hTFrom: tFrom.hash(),
                hTTo: tTo.hash(),
                hUFrom: uFrom.hash(),
                hUTo: uTo.hash(),
                tFrom: tFrom.toCircuitInput(),
                tTo: tTo.toCircuitInput(),
                uFrom: uFrom.toCircuitInput(),
                uTo: uTo.toCircuitInput(),
                fromUpdatedTroops: fromUpdatedTroops.toString(),
                toUpdatedTroops: toUpdatedTroops.toString(),
            },
            Board.MOVE_WASM,
            Board.MOVE_PROVKEY
        );

        return [tFrom, tTo, uFrom, uTo, proof, publicSignals];
    }
}
