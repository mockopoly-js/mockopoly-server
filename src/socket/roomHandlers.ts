import type { Server, Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';
import { EVENTS } from '../types/SocketEvents';
import type {
  C_RoomCreate, C_RoomJoin, C_RoomReady,
  S_ConnectAck, S_RoomCreated, S_RoomJoined, S_RoomRejected,
  S_PlayerJoined, S_PlayerLeft, S_PlayerReady, S_Countdown,
  S_StateUpdate, S_PlayerDisconnected, S_PlayerReconnected, S_Error,
} from '../types/SocketEvents';
import { gameManager } from '../game/GameManager';
import { RULES } from '../constants/rules';

// ─── Room Handlers ───────────────────────────────────────────────────────────

export function registerRoomHandlers(io: Server, socket: Socket): void {
  // ── Connect acknowledgment ──────────────────────────────────────────────────
  // Send a temporary ID on connect; real playerId assigned on room:create/join
  socket.emit(EVENTS.CONNECT_ACK, { playerId: socket.id } satisfies S_ConnectAck);

  // ── Create Room ─────────────────────────────────────────────────────────────

  socket.on(EVENTS.ROOM_CREATE, (data: C_RoomCreate) => {
    const { playerName, token } = data;

    // Validate
    if (!playerName || playerName.trim().length === 0) {
      return socket.emit(EVENTS.ERROR, { code: 'INVALID_NAME', message: 'Player name is required.' } satisfies S_Error);
    }

    const room = gameManager.createRoom(socket.id, playerName.trim(), token);
    const player = room.getPlayerBySocketId(socket.id)!;

    // Join the Socket.io room
    socket.join(room.state.roomCode);

    // Store playerId on socket for later lookups
    (socket as any).playerId = player.id;
    (socket as any).roomCode = room.state.roomCode;

    socket.emit(EVENTS.ROOM_CREATED, {
      roomCode: room.state.roomCode,
      state: room.state,
    } satisfies S_RoomCreated);

    console.log(`[room] ${playerName} created room ${room.state.roomCode}`);
  });

  // ── Join Room ───────────────────────────────────────────────────────────────

  socket.on(EVENTS.ROOM_JOIN, (data: C_RoomJoin) => {
    const { roomCode, playerName, token, reconnectToken } = data;

    const room = gameManager.getRoom(roomCode.toUpperCase());
    if (!room) {
      return socket.emit(EVENTS.ROOM_REJECTED, { reason: 'Room not found.' } satisfies S_RoomRejected);
    }

    // ── Reconnect path ────────────────────────────────────────────────────────
    if (reconnectToken) {
      const existing = room.getPlayerByReconnectToken(reconnectToken);
      if (existing) {
        existing.isConnected = true;
        room.updateSocketId(existing.id, socket.id);

        socket.join(roomCode);
        (socket as any).playerId = existing.id;
        (socket as any).roomCode = roomCode;

        socket.emit(EVENTS.ROOM_JOINED, { state: room.state } satisfies S_RoomJoined);
        socket.to(roomCode).emit(EVENTS.GAME_PLAYER_RECONNECTED, { playerId: existing.id } satisfies S_PlayerReconnected);
        io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);

        console.log(`[room] ${existing.name} reconnected to room ${roomCode}`);
        return;
      }
    }

    // ── Fresh join ────────────────────────────────────────────────────────────
    if (room.state.status !== 'lobby') {
      return socket.emit(EVENTS.ROOM_REJECTED, { reason: 'Game has already started.' } satisfies S_RoomRejected);
    }
    if (room.state.players.length >= room.state.config.maxPlayers) {
      return socket.emit(EVENTS.ROOM_REJECTED, { reason: 'Room is full.' } satisfies S_RoomRejected);
    }
    if (!playerName || playerName.trim().length === 0) {
      return socket.emit(EVENTS.ROOM_REJECTED, { reason: 'Player name is required.' } satisfies S_RoomRejected);
    }
    if (room.isTokenTaken(token)) {
      return socket.emit(EVENTS.ROOM_REJECTED, { reason: 'That token colour is already taken.' } satisfies S_RoomRejected);
    }

    const playerId = uuid();
    const reconnect = uuid();
    const player = room.addPlayer(playerId, socket.id, playerName.trim(), token, reconnect, false);

    socket.join(roomCode);
    (socket as any).playerId = playerId;
    (socket as any).roomCode = roomCode;

    socket.emit(EVENTS.ROOM_JOINED, { state: room.state } satisfies S_RoomJoined);
    socket.to(roomCode).emit(EVENTS.ROOM_PLAYER_JOINED, { player } satisfies S_PlayerJoined);
    // Broadcast updated state so all clients (including host) see the new player
    io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);

    console.log(`[room] ${playerName} joined room ${roomCode} (${room.state.players.length} players)`);
  });

  // ── Ready Toggle ────────────────────────────────────────────────────────────

  socket.on(EVENTS.ROOM_READY, (data: C_RoomReady) => {
    const roomCode = (socket as any).roomCode as string | undefined;
    const playerId = (socket as any).playerId as string | undefined;
    if (!roomCode || !playerId) return;

    const room = gameManager.getRoom(roomCode);
    if (!room) return;

    room.setReady(playerId, data.isReady);

    io.to(roomCode).emit(EVENTS.ROOM_PLAYER_READY, {
      playerId,
      isReady: data.isReady,
    } satisfies S_PlayerReady);

    // Broadcast full state so clients have the updated ready flag
    io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
  });

  // ── Start Game ──────────────────────────────────────────────────────────────

  socket.on(EVENTS.ROOM_START, () => {
    const roomCode = (socket as any).roomCode as string | undefined;
    const playerId = (socket as any).playerId as string | undefined;
    if (!roomCode || !playerId) return;

    const room = gameManager.getRoom(roomCode);
    if (!room) return;

    const player = room.getPlayer(playerId);
    if (!player?.isHost) {
      return socket.emit(EVENTS.ERROR, { code: 'NOT_HOST', message: 'Only the host can start the game.' } satisfies S_Error);
    }

    if (room.state.players.length < 1) { // DEV HACK — was < 2
      return socket.emit(EVENTS.ERROR, { code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 1 player.' } satisfies S_Error);
    }

    if (!room.allReady()) {
      return socket.emit(EVENTS.ERROR, { code: 'NOT_ALL_READY', message: 'All players must be ready.' } satisfies S_Error);
    }

    // Start countdown then game
    room.state.status = 'starting';
    io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);

    let countdown = 3;
    const timer = setInterval(() => {
      io.to(roomCode).emit(EVENTS.ROOM_COUNTDOWN, { seconds: countdown } satisfies S_Countdown);
      countdown--;

      if (countdown < 0) {
        clearInterval(timer);
        room.startGame();

        io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
        io.to(roomCode).emit(EVENTS.TURN_STARTED, { playerId: room.state.turn.currentPlayerId });

        console.log(`[room] Game started in room ${roomCode}`);
      }
    }, 1000);
  });

  // ── Leave / Disconnect ──────────────────────────────────────────────────────

  socket.on(EVENTS.ROOM_LEAVE, () => {
    handleLeave(io, socket);
  });

  socket.on('disconnect', () => {
    handleDisconnect(io, socket);
  });
}

// ── Helper: player leaves voluntarily ─────────────────────────────────────────

function handleLeave(io: Server, socket: Socket): void {
  const roomCode = (socket as any).roomCode as string | undefined;
  const playerId = (socket as any).playerId as string | undefined;
  if (!roomCode || !playerId) return;

  const room = gameManager.getRoom(roomCode);
  if (!room) return;

  socket.leave(roomCode);

  // Clear socket metadata so it can join/create another room
  (socket as any).roomCode = undefined;
  (socket as any).playerId = undefined;

  if (room.state.status === 'lobby') {
    const player = room.getPlayer(playerId);
    room.removePlayer(playerId);

    if (room.state.players.length === 0) {
      gameManager.removeRoom(roomCode);
      console.log(`[room] Room ${roomCode} removed (empty)`);
      return;
    }

    // Transfer host if needed
    if (player?.isHost && room.state.players.length > 0) {
      room.state.players[0].isHost = true;
    }

    io.to(roomCode).emit(EVENTS.ROOM_PLAYER_LEFT, { playerId } satisfies S_PlayerLeft);
    io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);

    console.log(`[room] Player ${playerId} left room ${roomCode}`);
  }
}

// ── Helper: socket disconnects (may reconnect) ───────────────────────────────

function handleDisconnect(io: Server, socket: Socket): void {
  const roomCode = (socket as any).roomCode as string | undefined;
  const playerId = (socket as any).playerId as string | undefined;
  if (!roomCode || !playerId) return;

  const room = gameManager.getRoom(roomCode);
  if (!room) return;

  if (room.state.status === 'lobby') {
    // In lobby, treat disconnect as leave
    handleLeave(io, socket);
    return;
  }

  // In game, mark disconnected with reconnect window
  room.setConnected(playerId, false);

  io.to(roomCode).emit(EVENTS.GAME_PLAYER_DISCONNECTED, {
    playerId,
    reconnectWindowSeconds: RULES.RECONNECT_WINDOW_SECONDS,
  } satisfies S_PlayerDisconnected);
  io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);

  console.log(`[room] Player ${playerId} disconnected from room ${roomCode} (${RULES.RECONNECT_WINDOW_SECONDS}s to reconnect)`);

  // Auto-bankrupt after reconnect window
  setTimeout(() => {
    const currentRoom = gameManager.getRoom(roomCode);
    if (!currentRoom) return;

    const player = currentRoom.getPlayer(playerId);
    if (player && !player.isConnected && !player.isBankrupt) {
      currentRoom.declareBankruptcy(playerId, null);
      io.to(roomCode).emit(EVENTS.PLAYER_BANKRUPT, { playerId, creditorId: null });
      io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: currentRoom.state } satisfies S_StateUpdate);

      // If it was their turn, advance
      if (currentRoom.state.turn.currentPlayerId === playerId && currentRoom.state.status === 'in-progress') {
        const nextId = currentRoom.advanceTurn();
        io.to(roomCode).emit(EVENTS.TURN_STARTED, { playerId: nextId });
        io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: currentRoom.state } satisfies S_StateUpdate);
      }

      console.log(`[room] Player ${playerId} auto-bankrupted (disconnect timeout)`);
    }
  }, RULES.RECONNECT_WINDOW_SECONDS * 1000);
}
