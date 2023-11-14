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
cursor = PLAYER_SPAWN;

const PLAYER = new Player(PLAYER_SYMBOL, signer.address);

const BOARD_SIZE: number = 3;
let board = createBoard();

function createBoard(): Tile[][] {
    let board: Tile[][] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        board[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (r === cursor.r && c === cursor.c) {
                board[r][c] = Tile.genOwned(PLAYER, { r, c }, 30, 0, 0, 0);
            } else {
                board[r][c] = Tile.mystery({ r, c });
            }
        }
    }
    return board;
}

function printBoard(board: Tile[][]): void {
    console.log();
    for (let r = 0; r < board.length; r++) {
        let row = "";
        for (let c = 0; c < board[r].length; c++) {
            let tile = board[r][c];
            if (tile.owner === PLAYER) {
                row += `[${tile.resources}]`;
            } else if (tile.owner === Tile.MYSTERY) {
                row += "[?]";
            }
        }
        console.log(row);
    }

    let tilesJSON = [];
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            tilesJSON.push(board[r][c].toJSONRedact());
        }
    }
    let boardJSON = { tiles: tilesJSON };
    console.log(boardJSON);
}

function move(str: string) {
    const move = MOVE_KEYS[str];
    if (move) {
        const oldTile = board[cursor.r][cursor.c];
        const newTile = Tile.genOwned(
            PLAYER,
            { r: cursor.r + move[0], c: cursor.c + move[1] },
            oldTile.resources - 1,
            oldTile.cityId,
            oldTile.latestUpdateInterval,
            oldTile.tileType
        );
        board[cursor.r][cursor.c] = Tile.genOwned(
            PLAYER,
            cursor,
            1,
            oldTile.cityId,
            oldTile.latestUpdateInterval,
            oldTile.tileType
        );
        cursor = { r: cursor.r + move[0], c: cursor.c + move[1] };
        board[cursor.r][cursor.c] = newTile;
    }
    printBoard(board);
}

printBoard(board);
process.stdin.resume();
process.stdin.on("data", (key) => {
    // ESC
    if (key.toString() === "\u001B") {
        console.log("Exiting...");
        process.exit();
    }
});
await new Promise((resolve) => process.stdin.once("data", resolve));

process.stdin.on("keypress", async (str, key) => {
    move(key.name);
});
