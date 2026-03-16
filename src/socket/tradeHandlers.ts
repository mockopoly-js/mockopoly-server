import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import { EVENTS } from '../types/SocketEvents';
import type {
  C_TradeOffer, C_TradeCounter, C_TradeAction,
  S_TradeOffered, S_TradeCountered, S_TradeResolved,
  S_StateUpdate, S_Error,
} from '../types/SocketEvents';
import type { TradeOffer } from '../types/GameState';
import { gameManager } from '../game/GameManager';
import { GameEngine } from '../game/GameEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContext(socket: Socket) {
  const roomCode = (socket as any).roomCode as string | undefined;
  const playerId = (socket as any).playerId as string | undefined;
  if (!roomCode || !playerId) return null;
  const room = gameManager.getRoom(roomCode);
  if (!room) return null;
  return { roomCode, playerId, room };
}

function emitError(socket: Socket, message: string): void {
  socket.emit(EVENTS.ERROR, { code: 'TRADE_ERROR', message } satisfies S_Error);
}

function broadcastState(io: Server, roomCode: string): void {
  const room = gameManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
}

// ─── Trade Handlers ──────────────────────────────────────────────────────────

export function registerTradeHandlers(io: Server, socket: Socket): void {

  // ── Offer ───────────────────────────────────────────────────────────────────

  socket.on(EVENTS.TRADE_OFFER, (data: C_TradeOffer) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const canTrade = GameEngine.canTrade(room, playerId, data.toPlayerId);
    if (canTrade) return emitError(socket, canTrade);

    const assetErr = GameEngine.validateTradeAssets(
      room, playerId, data.toPlayerId,
      data.offeredProperties, data.requestedProperties,
      data.offeredMoney, data.requestedMoney,
      data.offeredJailCards, data.requestedJailCards,
    );
    if (assetErr) return emitError(socket, assetErr);

    const offer: TradeOffer = {
      tradeId: uuid(),
      fromPlayerId: playerId,
      toPlayerId: data.toPlayerId,
      offeredProperties: data.offeredProperties,
      requestedProperties: data.requestedProperties,
      offeredMoney: data.offeredMoney,
      requestedMoney: data.requestedMoney,
      offeredJailCards: data.offeredJailCards,
      requestedJailCards: data.requestedJailCards,
      status: 'pending',
    };

    room.createTrade(offer);
    const player = room.getPlayer(playerId)!;
    const target = room.getPlayer(data.toPlayerId)!;
    room.addLog(playerId, 'trade', `${player.name} offered a trade to ${target.name}.`);

    io.to(roomCode).emit(EVENTS.TRADE_OFFERED, { offer } satisfies S_TradeOffered);
    broadcastState(io, roomCode);
  });

  // ── Counter ─────────────────────────────────────────────────────────────────

  socket.on(EVENTS.TRADE_COUNTER, (data: C_TradeCounter) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const trade = room.state.activeTrade;
    if (!trade || trade.tradeId !== data.tradeId) return emitError(socket, 'No matching trade.');
    if (trade.toPlayerId !== playerId) return emitError(socket, 'Not your trade to counter.');

    const assetErr = GameEngine.validateTradeAssets(
      room, playerId, trade.fromPlayerId,
      data.offeredProperties, data.requestedProperties,
      data.offeredMoney, data.requestedMoney,
      data.offeredJailCards, data.requestedJailCards,
    );
    if (assetErr) return emitError(socket, assetErr);

    // Swap perspectives: counter-offer swaps from/to
    const counter: TradeOffer = {
      tradeId: trade.tradeId,
      fromPlayerId: playerId,
      toPlayerId: trade.fromPlayerId,
      offeredProperties: data.offeredProperties,
      requestedProperties: data.requestedProperties,
      offeredMoney: data.offeredMoney,
      requestedMoney: data.requestedMoney,
      offeredJailCards: data.offeredJailCards,
      requestedJailCards: data.requestedJailCards,
      status: 'countered',
    };

    room.createTrade(counter);

    io.to(roomCode).emit(EVENTS.TRADE_COUNTERED, {
      tradeId: trade.tradeId, offer: counter,
    } satisfies S_TradeCountered);
    broadcastState(io, roomCode);
  });

  // ── Accept ──────────────────────────────────────────────────────────────────

  socket.on(EVENTS.TRADE_ACCEPT, (data: C_TradeAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const trade = room.state.activeTrade;
    if (!trade || trade.tradeId !== data.tradeId) return emitError(socket, 'No matching trade.');
    if (trade.toPlayerId !== playerId) return emitError(socket, 'Not your trade to accept.');

    // Re-validate at execution time
    const assetErr = GameEngine.validateTradeAssets(
      room, trade.fromPlayerId, trade.toPlayerId,
      trade.offeredProperties, trade.requestedProperties,
      trade.offeredMoney, trade.requestedMoney,
      trade.offeredJailCards, trade.requestedJailCards,
    );
    if (assetErr) {
      room.cancelTrade();
      return emitError(socket, `Trade invalid: ${assetErr}`);
    }

    room.executeTrade(trade);

    io.to(roomCode).emit(EVENTS.TRADE_ACCEPTED, { tradeId: trade.tradeId });
    io.to(roomCode).emit(EVENTS.TRADE_COMPLETED, { tradeId: trade.tradeId } satisfies S_TradeResolved);
    broadcastState(io, roomCode);
  });

  // ── Reject ──────────────────────────────────────────────────────────────────

  socket.on(EVENTS.TRADE_REJECT, (data: C_TradeAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const trade = room.state.activeTrade;
    if (!trade || trade.tradeId !== data.tradeId) return emitError(socket, 'No matching trade.');
    if (trade.toPlayerId !== playerId) return emitError(socket, 'Not your trade to reject.');

    room.cancelTrade();

    io.to(roomCode).emit(EVENTS.TRADE_REJECTED, { tradeId: trade.tradeId } satisfies S_TradeResolved);
    broadcastState(io, roomCode);
  });

  // ── Cancel (by offerer) ─────────────────────────────────────────────────────

  socket.on(EVENTS.TRADE_CANCEL, (data: C_TradeAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const trade = room.state.activeTrade;
    if (!trade || trade.tradeId !== data.tradeId) return emitError(socket, 'No matching trade.');
    if (trade.fromPlayerId !== playerId) return emitError(socket, 'Not your trade to cancel.');

    room.cancelTrade();

    io.to(roomCode).emit(EVENTS.TRADE_CANCELLED, { tradeId: trade.tradeId } satisfies S_TradeResolved);
    broadcastState(io, roomCode);
  });
}
