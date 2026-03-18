import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import { EVENTS } from '../types/SocketEvents';
import type {
  C_PartnershipPropose, C_PartnershipAction,
  C_PartnershipDissolve, C_PartnershipDissolveAction,
  S_PartnershipProposed, S_PartnershipProposalAccepted,
  S_PartnershipProposalRejected, S_PartnershipProposalCancelled,
  S_PartnershipFormed, S_PartnershipDissolveRequested,
  S_PartnershipDissolveAccepted, S_PartnershipDissolveRejected,
  S_PartnershipDissolved,
  S_StateUpdate, S_Error,
} from '../types/SocketEvents';
import type { PartnershipProposal, PartnershipDissolutionRequest } from '../types/GameState';
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
  socket.emit(EVENTS.ERROR, { code: 'PARTNERSHIP_ERROR', message } satisfies S_Error);
}

function broadcastState(io: Server, roomCode: string): void {
  const room = gameManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
}

// ─── Partnership Handlers ───────────────────────────────────────────────────

export function registerPartnershipHandlers(io: Server, socket: Socket): void {

  // ── Propose ──────────────────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_PROPOSE, (data: C_PartnershipPropose) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canProposePartnership(
      room, playerId, data.colorGroup, data.proposedEquity,
    );
    if (err) return emitError(socket, err);

    const proposal: PartnershipProposal = {
      proposalId: uuid(),
      initiatorId: playerId,
      colorGroup: data.colorGroup,
      proposedEquity: data.proposedEquity,
      acceptedPlayerIds: [playerId], // initiator auto-accepts
      status: 'pending',
    };

    room.createPartnershipProposal(proposal);

    const player = room.getPlayer(playerId)!;
    room.addLog(playerId, 'partnership', `${player.name} proposed a partnership on ${data.colorGroup} zone.`);

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_PROPOSED, { proposal } satisfies S_PartnershipProposed);
    broadcastState(io, roomCode);
  });

  // ── Accept Proposal ──────────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_ACCEPT_PROPOSAL, (data: C_PartnershipAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const proposal = room.state.activePartnershipProposal;
    if (!proposal || proposal.proposalId !== data.proposalId) {
      return emitError(socket, 'No matching proposal.');
    }

    // Only proposed partners can accept
    if (!proposal.proposedEquity.some(eq => eq.playerId === playerId)) {
      return emitError(socket, 'You are not part of this proposal.');
    }

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_PROPOSAL_ACCEPTED, {
      proposalId: data.proposalId, playerId,
    } satisfies S_PartnershipProposalAccepted);

    const formed = room.acceptPartnershipProposal(playerId);

    if (formed) {
      const partnership = room.getPartnershipForGroup(proposal.colorGroup as any);
      if (partnership) {
        io.to(roomCode).emit(EVENTS.PARTNERSHIP_FORMED, { partnership } satisfies S_PartnershipFormed);
      }
    }

    broadcastState(io, roomCode);
  });

  // ── Reject Proposal ──────────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_REJECT_PROPOSAL, (data: C_PartnershipAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const proposal = room.state.activePartnershipProposal;
    if (!proposal || proposal.proposalId !== data.proposalId) {
      return emitError(socket, 'No matching proposal.');
    }

    if (!proposal.proposedEquity.some(eq => eq.playerId === playerId)) {
      return emitError(socket, 'You are not part of this proposal.');
    }

    room.rejectPartnershipProposal();

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_PROPOSAL_REJECTED, {
      proposalId: data.proposalId, playerId,
    } satisfies S_PartnershipProposalRejected);
    broadcastState(io, roomCode);
  });

  // ── Cancel Proposal ──────────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_CANCEL_PROPOSAL, (data: C_PartnershipAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const proposal = room.state.activePartnershipProposal;
    if (!proposal || proposal.proposalId !== data.proposalId) {
      return emitError(socket, 'No matching proposal.');
    }

    if (proposal.initiatorId !== playerId) {
      return emitError(socket, 'Only the initiator can cancel.');
    }

    room.cancelPartnershipProposal();

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_PROPOSAL_CANCELLED, {
      proposalId: data.proposalId,
    } satisfies S_PartnershipProposalCancelled);
    broadcastState(io, roomCode);
  });

  // ── Request Dissolution ──────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_DISSOLVE_REQUEST, (data: C_PartnershipDissolve) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canDissolvePartnership(room, playerId, data.partnershipId);
    if (err) return emitError(socket, err);

    const request: PartnershipDissolutionRequest = {
      dissolutionId: uuid(),
      partnershipId: data.partnershipId,
      requesterId: playerId,
      acceptedPlayerIds: [playerId], // requester auto-accepts
      status: 'pending',
    };

    room.createDissolutionRequest(request);

    const player = room.getPlayer(playerId)!;
    room.addLog(playerId, 'partnership', `${player.name} requested partnership dissolution.`);

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_DISSOLVE_REQUESTED, {
      dissolutionId: request.dissolutionId,
      partnershipId: data.partnershipId,
      requesterId: playerId,
    } satisfies S_PartnershipDissolveRequested);
    broadcastState(io, roomCode);
  });

  // ── Accept Dissolution ───────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_ACCEPT_DISSOLVE, (data: C_PartnershipDissolveAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const req = room.state.activePartnershipDissolution;
    if (!req || req.dissolutionId !== data.dissolutionId) {
      return emitError(socket, 'No matching dissolution request.');
    }

    const partnership = room.getPartnershipById(req.partnershipId);
    if (!partnership || !partnership.partners.some(p => p.playerId === playerId)) {
      return emitError(socket, 'You are not a partner.');
    }

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_DISSOLVE_ACCEPTED, {
      dissolutionId: data.dissolutionId, playerId,
    } satisfies S_PartnershipDissolveAccepted);

    const dissolved = room.acceptDissolution(playerId);

    if (dissolved) {
      // Partnership was dissolved — refunds already applied in GameRoom
      const refunds: { playerId: string; amount: number }[] = [];
      io.to(roomCode).emit(EVENTS.PARTNERSHIP_DISSOLVED, {
        partnershipId: req.partnershipId, refunds,
      } satisfies S_PartnershipDissolved);
    }

    broadcastState(io, roomCode);
  });

  // ── Reject Dissolution ───────────────────────────────────────────────────

  socket.on(EVENTS.PARTNERSHIP_REJECT_DISSOLVE, (data: C_PartnershipDissolveAction) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const req = room.state.activePartnershipDissolution;
    if (!req || req.dissolutionId !== data.dissolutionId) {
      return emitError(socket, 'No matching dissolution request.');
    }

    room.rejectDissolution();

    io.to(roomCode).emit(EVENTS.PARTNERSHIP_DISSOLVE_REJECTED, {
      dissolutionId: data.dissolutionId, playerId,
    } satisfies S_PartnershipDissolveRejected);
    broadcastState(io, roomCode);
  });
}
