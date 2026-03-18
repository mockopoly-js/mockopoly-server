import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import { EVENTS } from '../types/SocketEvents';
import type {
  C_GoDeduction, C_DealOffer, C_DealCounter, C_DealAction,
  S_GoDeducted, S_DealOffered, S_DealCountered,
  S_DealAccepted, S_DealRejected, S_DealCompleted, S_DealCancelled,
  S_StateUpdate, S_Error,
} from '../types/SocketEvents';
import type { RentDeal } from '../types/GameState';
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
  socket.emit(EVENTS.ERROR, { code: 'DEAL_ERROR', message } satisfies S_Error);
}

function broadcastState(io: Server, roomCode: string): void {
  const room = gameManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
}

// ─── Deal & GO Deduction Handlers ───────────────────────────────────────────

export function registerDealHandlers(io: Server, socket: Socket): void {

  // ── GO Deduction ─────────────────────────────────────────────────────────

  socket.on(EVENTS.LOAN_GO_DEDUCTION, (data: C_GoDeduction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canGoDeduction(room, playerId, data.count);
    if (err) return emitError(socket, err);

    const amount = room.goDeduction(playerId, data.count);
    const player = room.getPlayer(playerId)!;

    io.to(roomCode).emit(EVENTS.LOAN_GO_DEDUCTED, {
      playerId,
      count: data.count,
      amount,
      totalUsed: player.goDeductionsUsed,
      skipsRemaining: player.goSkipsRemaining,
    } satisfies S_GoDeducted);

    // If player can now afford pending rent, auto-collect it
    const turn = room.state.turn;
    if (turn.mustPayRent && turn.rentAmount && turn.rentOwnerId && player.money >= turn.rentAmount) {
      room.collectRent(playerId, turn.rentOwnerId, turn.rentAmount, player.position);
      room.clearPendingRent();
    }

    broadcastState(io, roomCode);
  });

  // ── Offer Rent Deal ──────────────────────────────────────────────────────

  socket.on(EVENTS.DEAL_OFFER, (data: C_DealOffer) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canOfferRentDeal(
      room, playerId,
      data.offeredProperties, data.offeredMoney,
      data.requestedExemption, data.totalRentOwed,
    );
    if (err) return emitError(socket, err);

    const deal: RentDeal = {
      dealId: uuid(),
      debtorId: playerId,
      creditorIds: data.creditorIds,
      spaceIndex: data.spaceIndex,
      totalRentOwed: data.totalRentOwed,
      offeredProperties: data.offeredProperties,
      offeredMoney: data.offeredMoney,
      requestedExemption: data.requestedExemption,
      lastOfferBy: playerId,
      acceptedPlayerIds: [],
      status: 'pending',
    };

    room.createRentDeal(deal);

    const player = room.getPlayer(playerId)!;
    room.addLog(playerId, 'action', `${player.name} proposed a rent deal.`);

    io.to(roomCode).emit(EVENTS.DEAL_OFFERED, { deal } satisfies S_DealOffered);
    broadcastState(io, roomCode);
  });

  // ── Counter Rent Deal ────────────────────────────────────────────────────

  socket.on(EVENTS.DEAL_COUNTER, (data: C_DealCounter) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const currentDeal = room.state.activeRentDeal;
    if (!currentDeal || currentDeal.dealId !== data.dealId) {
      return emitError(socket, 'No matching deal.');
    }

    // Both debtor and creditor can counter (back-and-forth negotiation)
    const isDebtor = currentDeal.debtorId === playerId;
    const isCreditor = currentDeal.creditorIds.includes(playerId);
    if (!isDebtor && !isCreditor) {
      return emitError(socket, 'You are not part of this deal.');
    }

    // Can't counter your own last offer
    if (currentDeal.lastOfferBy === playerId) {
      return emitError(socket, 'Wait for the other party to respond before countering again.');
    }

    const counterDeal: RentDeal = {
      ...currentDeal,
      offeredProperties: data.offeredProperties,
      offeredMoney: data.offeredMoney,
      requestedExemption: data.requestedExemption,
      lastOfferBy: playerId,
      acceptedPlayerIds: [],
      status: 'countered',
    };

    room.counterRentDeal(counterDeal);

    io.to(roomCode).emit(EVENTS.DEAL_COUNTERED, { deal: counterDeal } satisfies S_DealCountered);
    broadcastState(io, roomCode);
  });

  // ── Accept Rent Deal ─────────────────────────────────────────────────────

  socket.on(EVENTS.DEAL_ACCEPT, (data: C_DealAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const deal = room.state.activeRentDeal;
    if (!deal || deal.dealId !== data.dealId) {
      return emitError(socket, 'No matching deal.');
    }

    // Creditors accept the debtor's offer, or debtor accepts the counter
    if (!deal.creditorIds.includes(playerId) && deal.debtorId !== playerId) {
      return emitError(socket, 'You are not part of this deal.');
    }

    io.to(roomCode).emit(EVENTS.DEAL_ACCEPTED, {
      dealId: data.dealId, playerId,
    } satisfies S_DealAccepted);

    const completed = room.acceptRentDeal(playerId);

    if (completed) {
      io.to(roomCode).emit(EVENTS.DEAL_COMPLETED, {
        dealId: data.dealId, exemptedAmount: deal.requestedExemption,
      } satisfies S_DealCompleted);
    }

    broadcastState(io, roomCode);
  });

  // ── Reject Rent Deal ─────────────────────────────────────────────────────

  socket.on(EVENTS.DEAL_REJECT, (data: C_DealAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const deal = room.state.activeRentDeal;
    if (!deal || deal.dealId !== data.dealId) {
      return emitError(socket, 'No matching deal.');
    }

    room.rejectRentDeal();

    io.to(roomCode).emit(EVENTS.DEAL_REJECTED, {
      dealId: data.dealId, playerId,
    } satisfies S_DealRejected);
    broadcastState(io, roomCode);
  });

  // ── Cancel Rent Deal ─────────────────────────────────────────────────────

  socket.on(EVENTS.DEAL_CANCEL, (data: C_DealAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const deal = room.state.activeRentDeal;
    if (!deal || deal.dealId !== data.dealId) {
      return emitError(socket, 'No matching deal.');
    }

    if (deal.debtorId !== playerId) {
      return emitError(socket, 'Only the debtor can cancel a deal.');
    }

    room.cancelRentDeal();

    io.to(roomCode).emit(EVENTS.DEAL_CANCELLED, { dealId: data.dealId } satisfies S_DealCancelled);
    broadcastState(io, roomCode);
  });
}
