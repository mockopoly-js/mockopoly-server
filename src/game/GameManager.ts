import { v4 as uuid } from 'uuid';
import { GameRoom } from './GameRoom';
import { RULES } from '../constants/rules';
import type { TokenType } from '../types/GameState';

// ─── Room Registry ───────────────────────────────────────────────────────────

export class GameManager {
  private rooms = new Map<string, GameRoom>();

  // ── Room lifecycle ──────────────────────────────────────────────────────────

  createRoom(hostSocketId: string, playerName: string, token: TokenType): GameRoom {
    const roomCode = this.generateRoomCode();
    const playerId = uuid();
    const reconnectToken = uuid();

    const room = new GameRoom(roomCode);
    room.addPlayer(playerId, hostSocketId, playerName, token, reconnectToken, true);

    this.rooms.set(roomCode, room);
    return room;
  }

  getRoom(roomCode: string): GameRoom | undefined {
    return this.rooms.get(roomCode);
  }

  removeRoom(roomCode: string): void {
    this.rooms.delete(roomCode);
  }

  /** Find the room a socket is currently in */
  findRoomBySocketId(socketId: string): GameRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.getPlayerBySocketId(socketId)) return room;
    }
    return undefined;
  }

  /** Find room + player by reconnect token */
  findByReconnectToken(reconnectToken: string): { room: GameRoom; playerId: string } | undefined {
    for (const room of this.rooms.values()) {
      const player = room.getPlayerByReconnectToken(reconnectToken);
      if (player) return { room, playerId: player.id };
    }
    return undefined;
  }

  // ── Idle cleanup ────────────────────────────────────────────────────────────

  /** Remove rooms that have been idle longer than ROOM_IDLE_TIMEOUT_MS */
  cleanupIdleRooms(): number {
    let removed = 0;
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.state.lastActionAt > RULES.ROOM_IDLE_TIMEOUT_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    let code: string;
    do {
      code = '';
      for (let i = 0; i < RULES.ROOM_CODE_LENGTH; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }
}

// Singleton
export const gameManager = new GameManager();
