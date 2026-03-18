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
    if (room.state.activeRentDeal) return 'A rent deal is still in progress.';
    if (room.state.activePartnershipProposal) return 'A partnership proposal is still active.';
    if (room.state.activePartnershipDissolution) return 'A partnership dissolution request is still active.';
    if (room.state.turn.mustPayRent) return 'You must resolve your debt before ending your turn.';
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
    if (prop.isMortgaged) return 'Property is mortgaged.';
    if (prop.hasHotel) return 'Property already has a hotel.';
    if (prop.houses >= RULES.MAX_HOUSES_PER_PROPERTY) return 'Maximum houses reached. Upgrade to hotel.';

    // Check if partnership exists for this group
    const partnership = space.colorGroup ? room.getPartnershipForGroup(space.colorGroup) : undefined;

    if (partnership) {
      // Partnership building — delegate to partnership-specific validation
      return this.canBuildHousePartnership(room, playerId, spaceIndex);
    }

    // Solo building — must own property and full color group
    if (prop.ownerId !== playerId) return 'You do not own this property.';

    const group = COLOR_GROUPS[space.colorGroup!];
    if (!group.every(idx => room.getPropertyState(idx)?.ownerId === playerId)) {
      return 'You must own all properties in this color group.';
    }

    // No mortgaged properties in group
    if (group.some(idx => room.getPropertyState(idx)?.isMortgaged)) {
      return 'All properties in the color group must be unmortgaged.';
    }

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

    if (player.money < space.houseCost!) return 'You cannot afford a hotel.';

    return null;
  }

  static canSellHouse(room: GameRoom, playerId: string, spaceIndex: number): string | null {
    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.ownerId !== playerId) return 'You do not own this property.';
    if (prop.houses <= 0) return 'No houses to sell.';
    if (prop.hasHotel) return 'Sell the hotel first.';

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
      if (room.isPropertyInPartnership(idx)) return 'Cannot trade properties in an active partnership. Dissolve the partnership first.';
    }
    for (const idx of requestedProperties) {
      if (!to.properties.includes(idx)) return `Target does not own property at space ${idx}.`;
      const prop = room.getPropertyState(idx)!;
      if (prop.houses > 0 || prop.hasHotel) return 'Cannot trade properties with buildings.';
      if (room.isPropertyInPartnership(idx)) return 'Cannot trade properties in an active partnership.';
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
        total += prop.houses * space.houseCost;
        if (prop.hasHotel) total += space.houseCost;
      }
    }

    return total;
  }

  // ── GO Deduction guards ────────────────────────────────────────────────────

  static canGoDeduction(room: GameRoom, playerId: string, count: number): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    const player = room.getPlayer(playerId);
    if (!player) return 'Player not found.';
    if (player.isBankrupt) return 'You are bankrupt.';
    if (count < 1) return 'Must deduct at least 1.';
    if (player.goDeductionsUsed + count > 5) return `Cannot exceed 5 lifetime GO deductions (${player.goDeductionsUsed} already used).`;
    // Only available when in debt (money < 0 or pending rent)
    if (player.money >= 0 && !room.state.turn.mustPayRent) return 'GO deduction is only available when in debt.';
    return null;
  }

  // ── Partnership guards ────────────────────────────────────────────────────

  static canProposePartnership(
    room: GameRoom, initiatorId: string, colorGroup: string,
    proposedEquity: { playerId: string; percentage: number }[],
  ): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (room.state.activePartnershipProposal) return 'A partnership proposal is already active.';

    const group = COLOR_GROUPS[colorGroup as keyof typeof COLOR_GROUPS];
    if (!group) return 'Invalid color group.';

    // Must be a houseable group (not railroad/utility)
    if (colorGroup === 'railroad' || colorGroup === 'utility') {
      return 'Partnerships are only for houseable color groups.';
    }

    // Check no active partnership exists for this group
    if (room.getPartnershipForGroup(colorGroup as any)) {
      return 'An active partnership already exists for this color group.';
    }

    // Validate equity entries
    if (proposedEquity.length < 2 || proposedEquity.length > 3) {
      return 'Partnership requires 2-3 partners.';
    }

    const totalPercentage = proposedEquity.reduce((sum, eq) => sum + eq.percentage, 0);
    if (totalPercentage !== 100) return 'Equity percentages must sum to 100.';

    for (const eq of proposedEquity) {
      if (eq.percentage < 1 || eq.percentage > 99) return 'Each partner must have 1-99% equity.';
      const player = room.getPlayer(eq.playerId);
      if (!player || player.isBankrupt) return `Player ${eq.playerId} is invalid or bankrupt.`;
    }

    // Check that proposed partners collectively own all properties in the group
    const partnerIds = proposedEquity.map(eq => eq.playerId);
    for (const idx of group) {
      const prop = room.getPropertyState(idx);
      if (!prop || !prop.ownerId || !partnerIds.includes(prop.ownerId)) {
        return 'Proposed partners must collectively own all properties in the color group.';
      }
    }

    // Initiator must be one of the partners
    if (!partnerIds.includes(initiatorId)) {
      return 'You must be one of the proposed partners.';
    }

    return null;
  }

  static canDissolvePartnership(room: GameRoom, playerId: string, partnershipId: string): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (room.state.activePartnershipDissolution) return 'A dissolution request is already active.';

    const partnership = room.getPartnershipById(partnershipId);
    if (!partnership || partnership.status !== 'active') return 'Partnership not found or inactive.';

    if (!partnership.partners.some(p => p.playerId === playerId)) {
      return 'You are not a partner in this partnership.';
    }

    return null;
  }

  // ── Rent Deal guards ──────────────────────────────────────────────────────

  static canOfferRentDeal(
    room: GameRoom, debtorId: string,
    offeredProperties: number[], offeredMoney: number, requestedExemption: number,
    totalRentOwed: number,
  ): string | null {
    if (room.state.status !== 'in-progress') return 'Game is not in progress.';
    if (room.state.activeRentDeal) return 'A rent deal is already active.';

    const debtor = room.getPlayer(debtorId);
    if (!debtor) return 'Player not found.';
    if (!room.state.turn.mustPayRent) return 'No pending rent to negotiate.';

    if (requestedExemption < 0 || requestedExemption > totalRentOwed) {
      return 'Exemption must be between 0 and total rent owed.';
    }

    if (offeredMoney < 0) return 'Offered money must be non-negative.';
    if (offeredMoney > debtor.money) return 'You cannot afford to offer that much money.';

    for (const idx of offeredProperties) {
      if (!debtor.properties.includes(idx)) return `You do not own property at space ${idx}.`;
      const prop = room.getPropertyState(idx)!;
      if (prop.houses > 0 || prop.hasHotel) return 'Cannot offer properties with buildings.';
      if (room.isPropertyInPartnership(idx)) return 'Cannot offer partnered properties.';
    }

    return null;
  }

  // ── Trade guards (partnership-aware) ──────────────────────────────────────

  static isPropertyInPartnership(room: GameRoom, spaceIndex: number): boolean {
    return room.isPropertyInPartnership(spaceIndex);
  }

  // ── Building guards (partnership-aware) ───────────────────────────────────

  static canBuildHousePartnership(
    room: GameRoom, playerId: string, spaceIndex: number,
  ): string | null {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex);
    if (!space || space.type !== 'property') return 'Not a property.';

    const prop = room.getPropertyState(spaceIndex);
    if (!prop) return 'Property not found.';
    if (prop.isMortgaged) return 'Property is mortgaged.';
    if (prop.hasHotel) return 'Property already has a hotel.';
    if (prop.houses >= RULES.MAX_HOUSES_PER_PROPERTY) return 'Maximum houses reached. Upgrade to hotel.';

    const partnership = space.colorGroup ? room.getPartnershipForGroup(space.colorGroup) : undefined;
    if (!partnership) return 'No partnership exists for this color group.';

    // Player must be a partner
    if (!partnership.partners.some(p => p.playerId === playerId)) {
      return 'You are not a partner in this color group.';
    }

    // No mortgaged properties in group
    const group = COLOR_GROUPS[space.colorGroup!];
    if (group.some(idx => room.getPropertyState(idx)?.isMortgaged)) {
      return 'All properties in the color group must be unmortgaged.';
    }

    // Check all partners can afford their share
    for (const partner of partnership.partners) {
      const p = room.getPlayer(partner.playerId);
      const share = Math.ceil(space.houseCost! * partner.percentage / 100);
      if (p && p.money < share) return `Partner ${p.name} cannot afford their share (£${share}).`;
    }

    return null;
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
