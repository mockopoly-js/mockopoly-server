import type { Server, Socket } from 'socket.io';
import { EVENTS } from '../types/SocketEvents';
import type { C_DevSetHack, S_DevHacksUpdated, S_StateUpdate, S_Error } from '../types/SocketEvents';
import type { DevHacks } from '../types/GameState';
import { gameManager } from '../game/GameManager';

// ─── Dev Hack Handlers ──────────────────────────────────────────────────────

const VALID_HACKS: (keyof DevHacks)[] = [
  'unlimitedMoney',
  'soloPlay',
  'alwaysLandOnMayfair',
  'alwaysLandOnCard',
  'sameTurn',
  'preAssignProperties',
];

export function registerDevHandlers(io: Server, socket: Socket): void {
  socket.on(EVENTS.DEV_SET_HACK, (data: C_DevSetHack) => {
    const roomCode = (socket as any).roomCode as string | undefined;
    if (!roomCode) return;

    const room = gameManager.getRoom(roomCode);
    if (!room) return;

    // Validate hack name
    if (!VALID_HACKS.includes(data.hack)) {
      return socket.emit(EVENTS.ERROR, {
        code: 'INVALID_HACK',
        message: `Unknown dev hack: ${data.hack}`,
      } satisfies S_Error);
    }

    room.setDevHack(data.hack, data.enabled);

    // Broadcast updated hacks to all clients in the room
    io.to(roomCode).emit(EVENTS.DEV_HACKS_UPDATED, {
      devHacks: room.state.devHacks,
    } satisfies S_DevHacksUpdated);

    // Also broadcast full state update so UI reflects changes
    io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, {
      state: room.state,
    } satisfies S_StateUpdate);

    console.log(`[dev] ${data.hack} ${data.enabled ? 'enabled' : 'disabled'} in room ${roomCode}`);
  });
}
