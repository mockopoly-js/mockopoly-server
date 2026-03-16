import type { GameRoom } from './GameRoom';
import { BOARD_SPACES, COLOR_GROUPS } from '../constants/board';
import { RULES } from '../constants/rules';

// ─── Pure Validation + Rules ─────────────────────────────────────────────────
// No mutations here — only boolean / reason checks.

export class GameEngine {

  // ── Turn guards ─────────────────────────────────────────────────────────────

  static isCurrentPlayer(room: GameRoom, playerId: string): boolean {
    return room.state.turn.currentPlayerId === playerId;
  }

  static canRoll(room: GameRoom, playerId: string): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    if (room.state.turn.hasRolled) return 'You have already rolled.';
    if (room.state.turn.phase !== 'waiting') return 'Cannot roll right now.';

    const player = room.getPlayer(playerId)!;
    if (player.isBankrupt) return 'You are bankrupt.';

    return null; // OK
  }

  static canJailRoll(room: GameRoom, playerId: string): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    if (room.state.turn.phase !== 'waiting') return 'Cannot roll right now.';

    const player = room.getPlayer(playerId)!;
    if (!player.isJailed) return 'You are not in jail.';

    return null;
  }

  static canPayJailFine(room: GameRoom, playerId: string): string | null {
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    const player = room.getPlayer(playerId)!;
    if (!player.isJailed) return 'You are not in jail.';
    if (player.money < RULES.JAIL_FINE) return 'You cannot afford the fine.';
    return null;
  }

  static canUseJailCard(room: GameRoom, playerId: string): string | null {
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    const player = room.getPlayer(playerId)!;
    if (!player.isJailed) return 'You are not in jail.';
    if (player.jailCardCount <= 0) return 'You have no Get Out of Jail Free cards.';
    return null;
  }

  static canEndTurn(room: GameRoom, playerId: string): string | null {
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    const phase = room.state.turn.phase;
    if (phase !== 'action' && phase !== 'end') return 'You cannot end your turn right now.';
    if (room.state.turn.auctionState?.status === 'active') return 'An auction is still in progress.';
    if (room.state.activeTrade) return 'A trade is still in progress.';
    return null;
  }

  // ── Property guards ─────────────────────────────────────────────────────────

  static canBuyProperty(room: GameRoom, playerId: string): string | null {
    if (!this.isCurrentPlayer(room, playerId)) return 'It is not your turn.';
    if (room.state.turn.phase !== 'action') return 'Cannot buy right now.';

    const player = room.getPlayer(playerId)!;
    const spaceIndex = player.position;
    const space = BOARD_SPACES.find(s => s.index === spaceIndex);

    if (!space || !space.price) return 'This space cannot be purchased.';

    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'This space cannot be purchased.';
    if (prop.ownerId) return 'This property is already owned.';
    if (player.money < space.price) return 'You cannot afford this property.';

    return null;
  }

  static canBuildHouse(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const player = room.getPlayer(playerId);
    if (!player) return 'Player not found.';

    const space = BOARD_SPACES.find(s => s.index === spaceIndex);
    if (!space || space.type !== 'property') return 'Not a property.';

    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (prop.isMortgaged) return 'Property is mortgaged.';
    if (prop.hasHotel) return 'Property already has a hotel.';
    if (prop.houses >= RULES.MAX_HOUSES_PER_PROPERTY) return 'Maximum houses reached. Upgrade to hotel.';

    // Must own full color group
    const group = COLOR_GROUPS[space.colorGroup!];
    if (!group.every(idx => room.getPropertyState(idx)?.ownerId === playerId)) {
      return 'You must own all properties in this color group.';
    }

    // No mortgaged properties in group
    if (group.some(idx => room.getPropertyState(idx)?.isMortgaged)) {
      return 'All properties in the color group must be unmortgaged.';
    }

    // Even building rule: cannot build unless this is the lowest in group
    const minHouses = Math.min(...group.map(idx => {
      const p = room.getPropertyState(idx)!;
      return p.hasHotel ? 5 : p.houses;
    }));
    const current = prop.houses;
    if (current > minHouses) return 'You must build evenly across the color group.';

    if (player.money < space.houseCost!) return 'You cannot afford a house.';

    return null;
  }

  static canBuildHotel(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const player = room.getPlayer(playerId);
    if (!player) return 'Player not found.';

    const space = BOARD_SPACES.find(s => s.index === spaceIndex);
    if (!space || space.type !== 'property') return 'Not a property.';

    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (prop.isMortgaged) return 'Property is mortgaged.';
    if (prop.hasHotel) return 'Property already has a hotel.';
    if (prop.houses < RULES.MAX_HOUSES_PER_PROPERTY) return 'Need 4 houses before building a hotel.';

    // Even building: all others in group must have 4 houses or a hotel
    const group = COLOR_GROUPS[space.colorGroup!];
    for (const idx of group) {
      if (idx === spaceIndex) continue;
      const p = room.getPropertyState(idx)!;
      if (!p.hasHotel && p.houses < RULES.MAX_HOUSES_PER_PROPERTY) {
        return 'You must build evenly across the color group.';
      }
    }

    if (player.money < space.houseCost!) return 'You cannot afford a hotel.';

    return null;
  }

  static canSellHouse(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (prop.houses <= 0) return 'No houses to sell.';
    if (prop.hasHotel) return 'Sell the hotel first.';

    // Even selling: cannot sell if this would make it lower than others in group
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const group = COLOR_GROUPS[space.colorGroup!];
    const maxHouses = Math.max(...group.map(idx => {
      const p = room.getPropertyState(idx)!;
      return p.hasHotel ? 5 : p.houses;
    }));
    if (prop.houses < maxHouses) return 'You must sell evenly across the color group.';

    return null;
  }

  static canSellHotel(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (!prop.hasHotel) return 'No hotel to sell.';

    return null;
  }

  // ── Mortgage guards ─────────────────────────────────────────────────────────

  static canMortgage(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (prop.isMortgaged) return 'Already mortgaged.';
    if (prop.houses > 0 || prop.hasHotel) return 'Sell all buildings first.';

    return null;
  }

  static canLiftMortgage(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (!prop.isMortgaged) return 'Not mortgaged.';

    const cost = Math.ceil(space.mortgageValue! * (1 + RULES.MORTGAGE_INTEREST_RATE));
    const player = room.getPlayer(playerId)!;
    if (player.money < cost) return `You cannot afford £${cost} to lift the mortgage.`;

    return null;
  }

  // ── Trade guards ────────────────────────────────────────────────────────────

  static canTrade(room: GameRoom, fromId: string, toId: string): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (room.state.activeTrade) return 'A trade is already in progress.';

    const from = room.getPlayer(fromId);
    const to = room.getPlayer(toId);
    if (!from || from.isBankrupt) return 'You cannot trade.';
    if (!to || to.isBankrupt) return 'Target player cannot trade.';
    if (fromId === toId) return 'Cannot trade with yourself.';

    return null;
  }

  static validateTradeAssets(
    room: GameRoom,
    fromId: string,
    toId: string,
    offeredProperties: number[],
    requestedProperties: number[],
    offeredMoney: number,
    requestedMoney: number,
    offeredJailCards: number,
    requestedJailCards: number,
  ): string | null {
    const from = room.getPlayer(fromId)!;
    const to = room.getPlayer(toId)!;

    // Verify property ownership
    for (const idx of offeredProperties) {
      if (!from.properties.includes(idx)) return `You do not own property at space ${idx}.`;
      const prop = room.getPropertyState(idx)!;
      if (prop.houses > 0 || prop.hasHotel) return 'Cannot trade properties with buildings. Sell buildings first.';
    }
    for (const idx of requestedProperties) {
      if (!to.properties.includes(idx)) return `Target does not own property at space ${idx}.`;
      const prop = room.getPropertyState(idx)!;
      if (prop.houses > 0 || prop.hasHotel) return 'Cannot trade properties with buildings.';
    }

    // Verify money
    if (offeredMoney < 0 || requestedMoney < 0) return 'Money amounts must be non-negative.';
    if (offeredMoney > from.money) return 'You cannot afford to offer that much money.';
    if (requestedMoney > to.money) return 'Target cannot afford that much money.';

    // Verify jail cards
    if (offeredJailCards < 0 || requestedJailCards < 0) return 'Jail card counts must be non-negative.';
    if (offeredJailCards > from.jailCardCount) return 'You do not have enough jail cards.';
    if (requestedJailCards > to.jailCardCount) return 'Target does not have enough jail cards.';

    return null;
  }

  // ── Auction guards ──────────────────────────────────────────────────────────

  static canBid(room: GameRoom, playerId: string, amount: number): string | null {
    const auction = room.state.turn.auctionState;
    if (!auction || auction.status !== 'active') return 'No active auction.';
    if (!auction.activeBidderIds.includes(playerId)) return 'You are not in this auction.';

    const player = room.getPlayer(playerId)!;
    if (amount <= auction.currentHighBid) return 'Bid must be higher than current bid.';
    if (amount > player.money) return 'You cannot afford this bid.';

    return null;
  }

  static canPassAuction(room: GameRoom, playerId: string): string | null {
    const auction = room.state.turn.auctionState;
    if (!auction || auction.status !== 'active') return 'No active auction.';
    if (!auction.activeBidderIds.includes(playerId)) return 'You are not in this auction.';
    return null;
  }

  // ── Bankruptcy check ────────────────────────────────────────────────────────

  /** Check if player can raise funds (has properties to mortgage or buildings to sell) */
  static canRaiseFunds(room: GameRoom, playerId: string): boolean {
    const player = room.getPlayer(playerId)!;

    for (const idx of player.properties) {
      const prop = room.getPropertyState(idx)!;
      if (prop.hasHotel || prop.houses > 0) return true;
      if (!prop.isMortgaged) return true;
    }

    return false;
  }

  /** Get total asset value (for bankruptcy — properties at mortgage value + buildings at half cost) */
  static totalAssetValue(room: GameRoom, playerId: string): number {
    const player = room.getPlayer(playerId)!;
    let total = player.money;

    for (const idx of player.properties) {
      const space = BOARD_SPACES.find(s => s.index === idx)!;
      const prop = room.getPropertyState(idx)!;

      if (!prop.isMortgaged) {
        total += space.mortgageValue!;
      }
      if (space.houseCost) {
        total += prop.houses * Math.floor(space.houseCost / 2);
        if (prop.hasHotel) total += Math.floor(space.houseCost / 2);
      }
    }

    return total;
  }

  // ── Space helpers ───────────────────────────────────────────────────────────

  static findNearestOfType(fromIndex: number, type: 'railroad' | 'utility'): number {
    const group = COLOR_GROUPS[type];
    // Find the first one ahead of current position (wrapping)
    for (const idx of group) {
      if (idx > fromIndex) return idx;
    }
    return group[0]; // wrap around
  }
}
