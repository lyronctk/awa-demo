import express from "express";
import http from "http";
import axios from "axios";
import crypto from "crypto";
import { Server, Socket } from "socket.io";
import { ethers, utils } from "ethers";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData,
} from "./socket";
import { Tile, Player, Board, Location, Utils } from "../game";

/*
 * Set game parameters and create dummy players.
 */
const BOARD_SIZE: number = parseInt(<string>process.env.BOARD_SIZE, 10);
const START_RESOURCES: number = parseInt(
    <string>process.env.START_RESOURCES,
    10
);

/*
 * Number of blocks that a claimed move is allowed to be pending without being
 * deleted.
 */
const CLAIMED_MOVE_LIFE_SPAN = parseInt(
    <string>process.env.CLAIMED_MOVE_LIFE_SPAN,
    10
);

/*
 * Using Socket.IO to manage communication to clients.
 */
const app = express();
const server = http.createServer(app);
const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(server);

/*
 * Boot up interface with Network States contract.
 */
const signer = new ethers.Wallet(
    <string>process.env.DEV_PRIV_KEY,
    new ethers.providers.JsonRpcProvider(process.env.RPC_URL)
);
const nStates = new ethers.Contract(
    <string>process.env.CONTRACT_ADDR,
    require(<string>process.env.CONTRACT_ABI).abi,
    signer
);

type ClaimedMove = {
    uFrom: Tile;
    uTo: Tile;
    blockSubmitted: number;
};

/*
 * Enclave's internal belief on game state stored in Board object.
 */
let b: Board;

/*
 * City ID given to each spawning player. Increments by one each time.
 *
 * [TODO]: eventually, the client will sample their own cityId, and the contract
 * will check that the cityId is not in use.
 */
let cityId: number = 1;

/*
 * Bijection between player's public keys and their socket IDs.
 */
let idToPubKey = new Map<string, string>();
let pubKeyToId = new Map<string, string>();

/*
 * Moves claimed by players. A move is finalized whenever NewMove event is
 * emitted.
 */
let claimedMoves = new Map<string, ClaimedMove>();

/*
 * Current block height. Storing the value in a variable saves from
 * unnecessarily indexing twice.
 */
let currentBlockHeight: number;

/*
 * Latest block height players proposed a move.
 */
let playerLatestBlock = new Map<string, number>();

/*
 * Signing private key for messages sent to data availability machine.
 */
let signingPrivkey: string;

/*
 * Dev function for spawning a player on the map or logging back in.
 *
 * [TODO]: the enclave should not be calling the contract's spawn
 * function on behalf of the player. In prod, client will sample cityId.
 */
async function login(
    socket: Socket,
    l: Location,
    reqPlayer: Player,
    sigStr: string
) {
    const h = Player.hForLogin(Utils.asciiIntoBigNumber(socket.id));
    const sig = Utils.unserializeSig(sigStr);
    if (sig && reqPlayer.verifySig(h, sig)) {
        const pubkey = reqPlayer.bjjPub.serialize();

        // Spawn if player is connected for the first time
        if (!b.isSpawned(reqPlayer)) {
            await b.spawn(l, reqPlayer, START_RESOURCES, cityId, nStates);
            cityId++;
        }

        // Pair the public key and the socket ID
        idToPubKey.set(socket.id, pubkey);
        pubKeyToId.set(pubkey, socket.id);

        playerLatestBlock.set(pubkey, 0);

        let visibleTiles = new Set<string>();
        b.playerCities.get(pubkey)?.forEach((cityId: number) => {
            b.cityTiles.get(cityId)?.forEach((locString: string) => {
                const tl = Utils.unstringifyLocation(locString);
                if (tl) {
                    for (let loc of b.getNearbyLocations(tl)) {
                        visibleTiles.add(Utils.stringifyLocation(loc));
                    }
                }
            });
        });
        socket.emit("loginResponse", Array.from(visibleTiles));
    }
}

/*
 * Propose move to enclave. In order for the move to be solidified, the enclave
 * must respond to a leaf event.
 */
async function getSignature(socket: Socket, uFrom: any, uTo: any) {
    const pubkey = idToPubKey.get(socket.id);
    if (pubkey) {
        // Players cannot make more than one move per block
        const latestBlock = playerLatestBlock.get(pubkey);
        if (latestBlock != undefined && latestBlock < currentBlockHeight) {
            const uFromAsTile = Tile.fromJSON(uFrom);
            const hUFrom = uFromAsTile.hash();
            const uToAsTile = Tile.fromJSON(uTo);
            const hUTo = uToAsTile.hash();

            claimedMoves.set(hUFrom.concat(hUTo), {
                uFrom: uFromAsTile,
                uTo: uToAsTile,
                blockSubmitted: currentBlockHeight,
            });

            const digest = utils.solidityKeccak256(
                ["uint256", "uint256", "uint256"],
                [currentBlockHeight, hUFrom, hUTo]
            );
            const sig = await signer.signMessage(utils.arrayify(digest));

            socket.emit("signatureResponse", sig, currentBlockHeight);

            playerLatestBlock.set(pubkey, currentBlockHeight);
        } else {
            socket.emit("errorResponse", "Cannot move more than once per tick");
        }
    }
}

/*
 * Exposes secrets at location l if a requesting player proves ownership of
 * neighboring tile.
 */
function decrypt(
    socket: Socket,
    l: Location,
    reqPlayer: Player,
    sigStr: string
) {
    const h = Player.hForDecrypt(l);
    const sig = Utils.unserializeSig(sigStr);
    if (sig && reqPlayer.verifySig(h, sig) && b.noFog(l, reqPlayer)) {
        socket.emit("decryptResponse", b.getTile(l).toJSON());
        return;
    }
    socket.emit("decryptResponse", Tile.mystery(l).toJSON());
}

/*
 * When a player disconnects, we remove the relation between their socket ID and
 * their public key. This is so that no other player gains that ID and can play
 * on their behalf.
 */
function disconnectPlayer(socket: Socket) {
    const pubKey = idToPubKey.get(socket.id);
    if (pubKey) {
        pubKeyToId.delete(pubKey);
        idToPubKey.delete(socket.id);
    }
}

/*
 * Callback function for when a NewMove event is emitted. Reads claimed move
 * into enclave's internal beliefs, and alerts players in range to decrypt.
 */
function onMoveFinalize(io: Server, hUFrom: string, hUTo: string) {
    const moveHash = hUFrom.concat(hUTo);
    const move = claimedMoves.get(moveHash);
    if (move) {
        // Move is no longer pending
        claimedMoves.delete(moveHash);

        // Before state is updated, we need the previous 'to' tile owner
        const tTo = b.getTile(move.uTo.loc);
        const newOwner = move.uTo.ownerPubKey();
        const prevOwner = tTo.ownerPubKey();
        const ownershipChanged = prevOwner !== newOwner;

        // Alert all nearby players that an updateDisplay is needed
        let updatedLocs = [move.uFrom.loc];
        if (ownershipChanged && tTo.isCapital()) {
            b.playerCities.get(prevOwner)?.forEach((cityId: number) => {
                b.cityTiles.get(cityId)?.forEach((locString: string) => {
                    const loc = Utils.unstringifyLocation(locString);
                    if (loc) {
                        updatedLocs.push(loc);
                    }
                });
            });
        } else if (ownershipChanged && tTo.isCity()) {
            b.cityTiles.get(tTo.cityId)?.forEach((locString: string) => {
                const loc = Utils.unstringifyLocation(locString);
                if (loc) {
                    updatedLocs.push(loc);
                }
            });
        } else {
            updatedLocs.push(move.uTo.loc);
        }

        // Update state
        b.setTile(move.uFrom);
        b.setTile(move.uTo);

        alertPlayers(io, newOwner, prevOwner, updatedLocs);
    } else {
        console.log(
            `Move: (${hUFrom}, ${hUTo}) was finalized without a signature.`
        );
    }
}

/*
 * Helper function for onMoveFinalize. Pings players when locations should be
 * decrypted. For each location in updatedLocs, the previous and new owner
 * decrypt all tiles in the 3x3 region, and nearby players decrypt the tile in
 * updatedLocs.
 */
function alertPlayers(
    io: Server,
    newOwner: string,
    prevOwner: string,
    updatedLocs: Location[]
) {
    let alertPlayerMap = new Map<string, Set<string>>();

    for (let loc of updatedLocs) {
        const locString = Utils.stringifyLocation(loc);
        for (let l of b.getNearbyLocations(loc)) {
            const tileOwner = b.getTile(l).ownerPubKey();
            const lString = Utils.stringifyLocation(l);

            if (!alertPlayerMap.has(tileOwner)) {
                alertPlayerMap.set(tileOwner, new Set<string>());
            }
            alertPlayerMap.get(tileOwner)?.add(locString);
            alertPlayerMap.get(newOwner)?.add(lString);
            alertPlayerMap.get(prevOwner)?.add(lString);
        }
    }

    alertPlayerMap.forEach((tiles: Set<string>, pubkey: string) => {
        const socketId = pubKeyToId.get(pubkey);
        if (socketId) {
            io.to(socketId).emit("updateDisplay", Array.from(tiles));
        }
    });
}

/*
 * Callback function called on new block events. Deletes claimed moves that
 * are unresolved for too long.
 */
function upkeepClaimedMoves() {
    for (let [h, c] of claimedMoves.entries()) {
        if (currentBlockHeight > c.blockSubmitted + CLAIMED_MOVE_LIFE_SPAN) {
            claimedMoves.delete(h);
        }
    }
}

/*
 * Attach event handlers to a new connection.
 */
io.on("connection", (socket: Socket) => {
    console.log("Client connected: ", socket.id);

    socket.on("login", (l: Location, p: string, s: string, sig: string) => {
        login(socket, l, Player.fromPubString(s, p), sig);
    });
    socket.on("getSignature", (uFrom: any, uTo: any) => {
        getSignature(socket, uFrom, uTo);
    });
    socket.on("decrypt", (l: Location, pubkey: string, sig: string) => {
        decrypt(socket, l, Player.fromPubString("", pubkey), sig);
    });

    socket.on("disconnecting", () => {
        disconnectPlayer(socket);
    });
});

/*
 * Event handler for NewMove event. io is passed in so that we can ping players.
 */
nStates.on(nStates.filters.NewMove(), (hUFrom, hUTo) => {
    onMoveFinalize(io, hUFrom.toString(), hUTo.toString());
});

/*
 * Event handler for new blocks. Claimed moves that have been stored for too
 * long should be deleted.
 */
nStates.provider.on("block", async (n) => {
    currentBlockHeight = n;
    upkeepClaimedMoves();
});

/*
 * Start server & initialize game.
 */
server.listen(process.env.ENCLAVE_SERVER_PORT, async () => {
    const keypair = crypto.generateKeyPairSync("rsa", {
        modulusLength: 1024,
        publicKeyEncoding: {
            type: "spki",
            format: "pem",
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
        },
    });
    signingPrivkey = keypair.privateKey;

    await axios.post(
        `http://localhost:${process.env.DA_SERVER_PORT}/setPubkey`,
        { pubkey: keypair.publicKey }
    );

    b = new Board();
    await b.seed(BOARD_SIZE, true, nStates);

    console.log(
        `Server running on http://localhost:${process.env.ENCLAVE_SERVER_PORT}`
    );
});
