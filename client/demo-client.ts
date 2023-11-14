import readline from "readline";
import { ethers } from "ethers";
import { io, Socket } from "socket.io-client";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import { Tile, Location } from "../game/Tile.js";
import { Player } from "../game/Player.js";
import { Board } from "../game/Board.js";
import { TerrainUtils } from "../game";

/*
 * Chain ID
 */
const CHAIN_ID: number = parseInt(<string>process.env.CHAIN_ID);

/*
 * Player arguments
 */
const PLAYER_PRIVKEY: string = process.argv[2];
const PLAYER_SYMBOL: string = process.argv[3];
const PLAYER_SPAWN: Location = {
    r: Number(process.argv[4]),
    c: Number(process.argv[5]),
};

const MOVE_PROMPT: string = "Next move: ";
const MOVE_KEYS: Record<string, number[]> = {
    w: [-1, 0],
    a: [0, -1],
    s: [1, 0],
    d: [0, 1],
};

/*
 * Boot up interface with 1) Network States contract and 2) the CLI.
 */
const signer = new ethers.Wallet(
    PLAYER_PRIVKEY,
    new ethers.providers.JsonRpcProvider(process.env.RPC_URL)
);
var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
let cursor: Location;

const PLAYER = new Player(PLAYER_SYMBOL, signer.address);

/*
 * Client's local belief on game state stored in Board object.
 */
let b: Board;

/*
 * Cache for terrain
 */
const terrainUtils = new TerrainUtils();

/*
 * Whether player has been spawned in.
 */
let isSpawned = false;

/*
 * Last block when player requested an enclave signature. Player's cannot submit
 * more than one move in a block.
 */
let clientLatestMoveBlock: number = 0;

console.log("player: ", PLAYER);
