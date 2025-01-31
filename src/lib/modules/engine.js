// * * * * * * * * * * * * * * * * * * * * * * * * * * *
//
//  engine.js =>
//  Handles communication with the colyseus
//  game server and maintains the shared state
//
// * * * * * * * * * * * * * * * * * * * * * * * * * * *

// Due to server side rendering issues, we need to include colyseus
// in a script tag in app.html, rather than here
// import * as Colyseus from "colyseus.js"
import { writable, get } from 'svelte/store';
import { nanoid } from "$lib/modules/utilities.js"
import { localPlayer } from "$lib/modules/world.js";
import { currentRoom  } from "$lib/modules/movement.js"
import { STATE } from "$lib/modules/ui.js";
import { uiState } from './ui';

export const players = writable({})
export const chatMessages = writable([])

// const GAME_SERVER_URL = "wss://open.eyebeam.dev";
// const GAME_SERVER_URL = "ws://5.161.136.54:2567";
// FIXME: add to .env, netlify env
const GAME_SERVER_URL = "wss://game-server.eyebeam.org";

// Public functions
export let moveTo = {}
export let goToRoom = {}
export let enterArticle = {}
export let leaveArticle = {}
export let onboardUser = {}
export let submitChat = {}

// let disconnectionCode = 0
// let reconnectionAttempts = 0

let gameClient = {}

// set how long we should keep messages for (in minutes)
const TIME_LIMIT = 20

export const connectToGameServer = playerObject => {
    gameClient = new Colyseus.Client(GAME_SERVER_URL)
    return new Promise((resolve, reject) => {

        // __ Join game room
        gameClient
            .joinOrCreate("game", playerObject)
            .then(gameRoom => {

                // Handle events sent from the server:

                // PLAYER => REMOVE
                gameRoom.state.players.onRemove = (player, sessionId) => {
                    players.update(ps => {
                        delete ps[player.uuid]
                        return (ps)
                    })
                }

                // PLAYER => ADD
                gameRoom.state.players.onAdd = (player, sessionId) => {
                    players.update(ps => {
                        ps[player.uuid] = {
                            name: player.name,
                            x: player.x,
                            y: player.y,
                            room: player.room,
                            npc: player.npc,
                            inTransit: false,
                            self: player.uuid === get(localPlayer).uuid,
                        }
                        return (ps)
                    })

                    // This is the local player
                    if (player.uuid === get(localPlayer).uuid) {
                        localPlayer.update(lp => {
                            lp.sessionId = sessionId
                            lp.name = player.name
                            return lp
                        })
                    }

                    // PLAYER => CHANGE
                    player.onChange = changes => {
                        if (get(players)[player.uuid].room !== player.room) {
                            // Player changed rooms
                            players.update(ps => {
                                ps[player.uuid].name = player.name
                                ps[player.uuid].shape = player.shape
                                ps[player.uuid].room = player.room
                                ps[player.uuid].inTransit = true
                                ps[player.uuid].viewing = player.viewing
                                ps[player.uuid].x = player.x
                                ps[player.uuid].y = player.y
                                return (ps)
                            })
                           setTimeout(() => {
                                players.update(ps => {
                                    ps[player.uuid].inTransit = false
                                    return (ps)
                                })
                            }, 1000)
                        } else {
                            players.update(ps => {
                                ps[player.uuid].name = player.name
                                ps[player.uuid].shape = player.shape
                                ps[player.uuid].viewing = player.viewing
                                return (ps)
                            })
                        }

                        if (player.uuid === get(localPlayer).uuid) {
                            // We don't update the location for the local player
                            return
                        }

                        players.update(ps => {
                            ps[player.uuid].x = player.x
                            ps[player.uuid].y = player.y
                            return (ps)
                        })
                    }
                }

                // PLAYER => BANNED
                gameRoom.onMessage("banned", message => {
                    uiState.set(STATE.ERROR)
                })

                moveTo = (x, y, keyboardNavigation) => {
                    if (keyboardNavigation) {
                        gameRoom.send("go", {
                            x: x,
                            y: y,
                            keyboardNavigation: true,
                        })
                    } else {
                        gameRoom.send("go", {
                            x: x,
                            y: y,
                            originX: get(players)[get(localPlayer).uuid].x,
                            originY: get(players)[get(localPlayer).uuid].y,
                            keyboardNavigation: false,
                        })
                    }
                }

                goToRoom = room => {
                    gameRoom.send("changeRoom", {
                        id: room.id,
                        x: room.x,
                        y: room.y,
                    })
                }

                enterArticle = article => {
                    gameRoom.send("enterArticle", {
                        id: article._id,
                    })
                }

                leaveArticle = () => {
                    gameRoom.send("leaveArticle")
                }

                // ********
                // MESSAGES
                // ********

                // MESSAGE => ADD
                gameRoom.state.messages.onAdd = message => {
                    chatMessages.update(cM => {
                        cM.push(message)
                        cM = cM.filter(message => {
                            // Remove chat messages older than time limit
                            let currentTime = Date.now()
                            if (message.timestamp <= currentTime - (TIME_LIMIT * 60 * 1000)) {
                                return false;
                            }
                            return true;
                        })
                        return cM
                    })
                }

                // MESSAGE => REMOVE
                gameRoom.onMessage("nukeMessage", msgIdToRemove => {
//                     const itemIndex = chatMessages.findIndex(
//                         m => m.msgId === msgIdToRemove
//                     )
//                     chatMessages.splice(itemIndex, 1)
//                     chatMessages = chatMessages
                })

                // MESSAGE => SUBMIT
                submitChat = (event, currentRoom) => {
                    try {
                        gameRoom.send("submitChatMessage", {
                            msgId: nanoid(),
                            uuid: get(localPlayer).uuid,
                            name: get(players)[get(localPlayer).uuid].name,
                            text: event.detail.text,
                            room: currentRoom._id,
                        })
                    } catch (err) {
                        uiState.set(STATE.ERROR)
                        console.dir(err)
                    }
                }

                // ******************************
                // CLIENT LEFT / WAS DISCONNECTED
                // ******************************
                gameRoom.onLeave(code => {
                    const exitMsg = "Disconnected from server. Code: " + code
                    uiState.set(STATE.DISCONNECTED)
                    // disconnectionCode = code
                    // reconnectionAttempts = 1
                    // TODO: Try to reconnect
                    // const reconnect = i => {
                    //     console.log(
                    //         "Trying to reconnect user:",
                    //         get(localUserSessionID),
                    //         "....",
                    //         i
                    //     )
                    //     gameClient
                    //         .reconnect("game", get(localUserSessionID))
                    //         .then(room => {
                    //             // __ Successfully reconnected
                    //             // setUIState(STATE.READY)
                    //         })
                    //         .catch(e => {
                    //             console.error("join error", e)
                    //         })
                    //     //   setInterval(() => {
                    //     //   reconnectionAttempts++
                    //     // }, 5000)
                    // }
                    // reconnect(1)
                })

                // ************************
                // GENERAL ERROR HANDLING
                // ************************
                gameRoom.onError((code, message) => {
                    uiState.set(STATE.ERROR)
                    console.error("Gameserver error:", message)
                })

                // DONE
                resolve()
            })
            .catch(e => {
                console.dir(e)
                if (e.code == 4215) {
                    uiState.set(STATE.ERROR)
                } else {
                    uiState.set(STATE.ERROR)
                    // setUIState(STATE.ERROR, "FAILED TO CONNECT TO GAMESERVER")
                }
              // ALLOW OFFLINE PLAYERS TO STILL WALK AROUND AND STUFF
              let player = get(localPlayer)
              players.update(ps => {
                  ps[player.uuid] = {
                                  name: player.name,
                                  x: Math.round(get(currentRoom).dimensions.width/2),
                                  y: Math.round(get(currentRoom).dimensions.height/2),
                                  room: get(currentRoom)._id,
                                  npc: false,
                                  inTransit: true,
                                  self: true

                  }
                  return ( ps )
              })
              setTimeout(() => {
              players.update(ps => {
                    ps[player.uuid].inTransit = false
                      return (ps)
                  })
              }, 1000)


                reject(e)
            })
    })
}
