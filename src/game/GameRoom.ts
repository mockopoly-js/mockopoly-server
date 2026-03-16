import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, PropertyState, TurnState, GameLogEntry,
  GameLogType, TokenType, DrawnCard, TradeOffer, AuctionState,
} from '../types/GameState';
import { BOARD_SPACES, PURCHASABLE_SPACES, COLOR_GROUPS } from '../constants/board';
import { RULES } from '../constants/rules';
import { CardDecks } from './CardDecks';

// ─── Socket ID tracking (not part of GameState — server-only) ───────────────

interface SocketMapping {
  playerId: string;
  socketId: string;
}

// ─── GameRoom ────────────────────────────────────────────────────────────────

export class GameRoom {
  state: GameState;
  private socketMap: SocketMapping[] = [];
  private cardDecks: CardDecks;

  constructor(roomCode: string) {
    this.state = {
      roomCode,
      status: 'lobby',
      players: [],
      properties: this.initProperties(),
      communityChestDeck: [],
      chanceDeck: [],
      communityChestDiscard: [],
      chanceDiscard: [],
      turn: this.emptyTurn(),
      activeTrade: null,
      log: [],
      config: {
        maxPlayers: RULES.MAX_PLAYERS,
        startingMoney: RULES.STARTING_MONEY,
        specialRules: {},
      },
      winnerId: null,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
    };
    this.cardDecks = new CardDecks();
  }

  // ── Player management ───────────────────────────────────────────────────────

  addPlayer(
    playerId: string, socketId: string, name: string,
    token: TokenType, reconnectToken: string, isHost: boolean,
  ): Player {
    const player: Player = {
      id: playerId, name, token,
      position: 0, money: this.state.config.startingMoney,
      properties: [], isJailed: false, jailTurns: 0, jailCardCount: 0,
      isBankrupt: false, isConnected: true, isHost, isReady: false,
      reconnectToken,
    };
    this.state.players.push(player);
    this.socketMap.push({ playerId, socketId });
    this.touch();
    return player;
  }

  removePlayer(playerId: string): void {
    this.state.players = this.state.players.filter(p => p.id !== playerId);
    this.socketMap = this.socketMap.filter(m => m.playerId !== playerId);
    this.touch();
  }

  getPlayer(playerId: string): Player | undefined {
    return this.state.players.find(p => p.id === playerId);
  }

  getPlayerBySocketId(socketId: string): Player | undefined {
    const mapping = this.socketMap.find(m => m.socketId === socketId);
    if (!mapping) return undefined;
    return this.getPlayer(mapping.playerId);
  }

  getPlayerByReconnectToken(token: string): Player | undefined {
    return this.state.players.find(p => p.reconnectToken === token);
  }

  getSocketId(playerId: string): string | undefined {
    return this.socketMap.find(m => m.playerId === playerId)?.socketId;
  }

  updateSocketId(playerId: string, newSocketId: string): void {
    const mapping = this.socketMap.find(m => m.playerId === playerId);
    if (mapping) mapping.socketId = newSocketId;
    else this.socketMap.push({ playerId, socketId: newSocketId });
  }

  setReady(playerId: string, isReady: boolean): void {
    const p = this.getPlayer(playerId);
    if (p) { p.isReady = isReady; this.touch(); }
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.getPlayer(playerId);
    if (p) { p.isConnected = connected; this.touch(); }
  }

  get activePlayers(): Player[] {
    return this.state.players.filter(p => !p.isBankrupt);
  }

  get connectedPlayers(): Player[] {
    return this.state.players.filter(p => p.isConnected);
  }

  allReady(): boolean {
    return this.state.players.length >= 2 && this.state.players.every(p => p.isReady);
  }

  isTokenTaken(token: TokenType): boolean {
    return this.state.players.some(p => p.token === token);
  }

  // ── Game start ──────────────────────────────────────────────────────────────

  startGame(): void {
    this.state.status = 'in-progress';
    this.cardDecks.shuffle();
    this.state.communityChestDeck = [...this.cardDecks.communityChestDeck];
    this.state.chanceDeck = [...this.cardDecks.chanceDeck];
    this.state.communityChestDiscard = [];
    this.state.chanceDiscard = [];

    // First player goes first
    const firstPlayer = this.state.players[0];
    this.state.turn = {
      currentPlayerId: firstPlayer.id,
      phase: 'waiting',
      diceValues: null,
      doublesCount: 0,
      hasRolled: false,
      mustPayRent: false,
      rentAmount: null,
      rentOwnerId: null,
      pendingCard: null,
      auctionState: null,
    };

    this.addLog(null, 'system', `Game started! ${firstPlayer.name} goes first.`);
    this.touch();
  }

  // ── Dice ────────────────────────────────────────────────────────────────────

  rollDice(): [number, number] {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.state.turn.diceValues = [d1, d2];
    this.state.turn.hasRolled = true;
    this.state.turn.phase = 'rolling';
    this.touch();
    return [d1, d2];
  }

  isDoubles(): boolean {
    const d = this.state.turn.diceValues;
    return d !== null && d[0] === d[1];
  }

  diceTotal(): number {
    const d = this.state.turn.diceValues;
    return d ? d[0] + d[1] : 0;
  }

  // ── Movement ────────────────────────────────────────────────────────────────

  movePlayer(playerId: string, spaces: number): { from: number; to: number; passedGo: boolean } {
    const player = this.getPlayer(playerId)!;
    const from = player.position;
    const to = (from + spaces) % 40;
    const passedGo = to < from && spaces > 0;

    player.position = to;
    this.state.turn.phase = 'moving';

    if (passedGo) {
      player.money += RULES.GO_SALARY;
      this.addLog(playerId, 'action', `${player.name} passed GO and collected £${RULES.GO_SALARY}.`);
    }

    this.touch();
    return { from, to, passedGo };
  }

  movePlayerTo(playerId: string, targetIndex: number): { from: number; to: number; passedGo: boolean } {
    const player = this.getPlayer(playerId)!;
    const from = player.position;
    const passedGo = targetIndex < from && targetIndex !== RULES.JAIL_SPACE_INDEX;

    player.position = targetIndex;

    if (passedGo) {
      player.money += RULES.GO_SALARY;
      this.addLog(playerId, 'action', `${player.name} passed GO and collected £${RULES.GO_SALARY}.`);
    }

    this.touch();
    return { from, to: targetIndex, passedGo };
  }

  movePlayerBack(playerId: string, spaces: number): { from: number; to: number } {
    const player = this.getPlayer(playerId)!;
    const from = player.position;
    const to = (from - spaces + 40) % 40;
    player.position = to;
    this.touch();
    return { from, to };
  }

  // ── Landing ─────────────────────────────────────────────────────────────────

  setPhase(phase: TurnState['phase']): void {
    this.state.turn.phase = phase;
    this.touch();
  }

  // ── Property ────────────────────────────────────────────────────────────────

  getPropertyState(spaceIndex: number): PropertyState | undefined {
    return this.state.properties.find(p => p.spaceIndex === spaceIndex);
  }

  buyProperty(playerId: string, spaceIndex: number): number {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const price = space.price!;

    player.money -= price;
    player.properties.push(spaceIndex);
    prop.ownerId = playerId;

    this.addLog(playerId, 'action', `${player.name} bought ${space.name} for £${price}.`);
    this.touch();
    return price;
  }

  calculateRent(spaceIndex: number, diceTotal: number): number {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;

    if (!prop.ownerId || prop.isMortgaged) return 0;

    if (space.type === 'property') {
      // Check if owner has full color group
      const group = COLOR_GROUPS[space.colorGroup!];
      const ownsFullGroup = group.every(idx =>
        this.getPropertyState(idx)?.ownerId === prop.ownerId
      );

      if (prop.hasHotel) {
        return space.rents![5]; // hotel rent
      }
      if (prop.houses > 0) {
        return space.rents![prop.houses];
      }
      // Unimproved — double if full group owned
      return ownsFullGroup ? space.rents![0] * 2 : space.rents![0];
    }

    if (space.type === 'railroad') {
      const ownedCount = COLOR_GROUPS['railroad'].filter(idx =>
        this.getPropertyState(idx)?.ownerId === prop.ownerId
      ).length;
      return space.railroadRents![ownedCount - 1];
    }

    if (space.type === 'utility') {
      const ownedCount = COLOR_GROUPS['utility'].filter(idx =>
        this.getPropertyState(idx)?.ownerId === prop.ownerId
      ).length;
      return diceTotal * space.utilityMultipliers![ownedCount - 1];
    }

    return 0;
  }

  collectRent(fromId: string, toId: string, amount: number, spaceIndex: number): void {
    const from = this.getPlayer(fromId)!;
    const to = this.getPlayer(toId)!;
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;

    from.money -= amount;
    to.money += amount;

    this.addLog(fromId, 'action', `${from.name} paid £${amount} rent to ${to.name} for ${space.name}.`);
    this.touch();
  }

  setPendingRent(amount: number, ownerId: string): void {
    this.state.turn.mustPayRent = true;
    this.state.turn.rentAmount = amount;
    this.state.turn.rentOwnerId = ownerId;
    this.touch();
  }

  clearPendingRent(): void {
    this.state.turn.mustPayRent = false;
    this.state.turn.rentAmount = null;
    this.state.turn.rentOwnerId = null;
    this.touch();
  }

  // ── Houses & Hotels ─────────────────────────────────────────────────────────

  addHouse(playerId: string, spaceIndex: number): void {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;

    prop.houses++;
    player.money -= space.houseCost!;

    this.addLog(playerId, 'action', `${player.name} built a house on ${space.name} (${prop.houses} houses).`);
    this.touch();
  }

  addHotel(playerId: string, spaceIndex: number): void {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;

    prop.houses = 0;
    prop.hasHotel = true;
    player.money -= space.houseCost!; // hotel costs same as house

    this.addLog(playerId, 'action', `${player.name} built a hotel on ${space.name}!`);
    this.touch();
  }

  sellHouse(playerId: string, spaceIndex: number): void {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const refund = Math.floor(space.houseCost! / 2);

    prop.houses--;
    player.money += refund;

    this.addLog(playerId, 'action', `${player.name} sold a house on ${space.name} for £${refund}.`);
    this.touch();
  }

  sellHotel(playerId: string, spaceIndex: number): void {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const refund = Math.floor(space.houseCost! / 2);

    prop.hasHotel = false;
    prop.houses = 4; // downgrade to 4 houses
    player.money += refund;

    this.addLog(playerId, 'action', `${player.name} sold the hotel on ${space.name} for £${refund}.`);
    this.touch();
  }

  // ── Mortgage ────────────────────────────────────────────────────────────────

  applyMortgage(playerId: string, spaceIndex: number): number {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const value = space.mortgageValue!;

    prop.isMortgaged = true;
    player.money += value;

    this.addLog(playerId, 'action', `${player.name} mortgaged ${space.name} for £${value}.`);
    this.touch();
    return value;
  }

  liftMortgage(playerId: string, spaceIndex: number): number {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const cost = Math.ceil(space.mortgageValue! * (1 + RULES.MORTGAGE_INTEREST_RATE));

    prop.isMortgaged = false;
    player.money -= cost;

    this.addLog(playerId, 'action', `${player.name} lifted the mortgage on ${space.name} for £${cost}.`);
    this.touch();
    return cost;
  }

  // ── Jail ────────────────────────────────────────────────────────────────────

  sendToJail(playerId: string): void {
    const player = this.getPlayer(playerId)!;
    player.position = RULES.JAIL_SPACE_INDEX;
    player.isJailed = true;
    player.jailTurns = 0;

    this.addLog(playerId, 'action', `${player.name} was sent to Jail!`);
    this.touch();
  }

  releaseFromJail(playerId: string, method: 'fine' | 'card' | 'doubles' | 'forced'): void {
    const player = this.getPlayer(playerId)!;
    player.isJailed = false;
    player.jailTurns = 0;

    if (method === 'fine' || method === 'forced') {
      player.money -= RULES.JAIL_FINE;
      this.addLog(playerId, 'action', `${player.name} paid £${RULES.JAIL_FINE} to get out of Jail.`);
    } else if (method === 'card') {
      player.jailCardCount--;
      this.addLog(playerId, 'action', `${player.name} used a Get Out of Jail Free card.`);
    } else {
      this.addLog(playerId, 'action', `${player.name} rolled doubles and escaped Jail!`);
    }

    this.touch();
  }

  incrementJailTurn(playerId: string): void {
    const player = this.getPlayer(playerId)!;
    player.jailTurns++;
    this.touch();
  }

  // ── Cards ───────────────────────────────────────────────────────────────────

  drawCard(deck: 'chance' | 'community-chest'): DrawnCard {
    const card = this.cardDecks.draw(deck);

    // Sync deck state
    if (deck === 'community-chest') {
      this.state.communityChestDeck = [...this.cardDecks.communityChestDeck];
      this.state.communityChestDiscard = [...this.cardDecks.communityChestDiscard];
    } else {
      this.state.chanceDeck = [...this.cardDecks.chanceDeck];
      this.state.chanceDiscard = [...this.cardDecks.chanceDiscard];
    }

    this.touch();
    return card;
  }

  setPendingCard(card: DrawnCard): void {
    this.state.turn.pendingCard = card;
    this.touch();
  }

  clearPendingCard(): void {
    this.state.turn.pendingCard = null;
    this.touch();
  }

  giveJailCard(playerId: string): void {
    const player = this.getPlayer(playerId)!;
    player.jailCardCount++;
    this.addLog(playerId, 'card', `${player.name} received a Get Out of Jail Free card.`);
    this.touch();
  }

  // ── Money ───────────────────────────────────────────────────────────────────

  adjustMoney(playerId: string, amount: number, reason?: string): void {
    const player = this.getPlayer(playerId)!;
    player.money += amount;
    if (reason) this.addLog(playerId, 'action', reason);
    this.touch();
  }

  /** Collect money from every other active player */
  collectFromAllPlayers(playerId: string, amountPerPlayer: number): number {
    const collector = this.getPlayer(playerId)!;
    let total = 0;

    for (const p of this.activePlayers) {
      if (p.id === playerId) continue;
      p.money -= amountPerPlayer;
      total += amountPerPlayer;
    }

    collector.money += total;
    this.touch();
    return total;
  }

  /** Pay money to every other active player */
  payAllPlayers(playerId: string, amountPerPlayer: number): number {
    const payer = this.getPlayer(playerId)!;
    let total = 0;

    for (const p of this.activePlayers) {
      if (p.id === playerId) continue;
      p.money += amountPerPlayer;
      total += amountPerPlayer;
    }

    payer.money -= total;
    this.touch();
    return total;
  }

  /** Calculate total building repair cost */
  calculateBuildingCost(playerId: string, perHouse: number, perHotel: number): number {
    let cost = 0;
    for (const prop of this.state.properties) {
      if (prop.ownerId !== playerId) continue;
      if (prop.hasHotel) cost += perHotel;
      else cost += prop.houses * perHouse;
    }
    return cost;
  }

  // ── Tax ─────────────────────────────────────────────────────────────────────

  payTax(playerId: string, amount: number): void {
    const player = this.getPlayer(playerId)!;
    player.money -= amount;
    this.addLog(playerId, 'action', `${player.name} paid £${amount} tax.`);
    this.touch();
  }

  // ── Trade ───────────────────────────────────────────────────────────────────

  createTrade(offer: TradeOffer): void {
    this.state.activeTrade = offer;
    this.touch();
  }

  executeTrade(trade: TradeOffer): void {
    const from = this.getPlayer(trade.fromPlayerId)!;
    const to = this.getPlayer(trade.toPlayerId)!;

    // Transfer properties
    for (const idx of trade.offeredProperties) {
      from.properties = from.properties.filter(p => p !== idx);
      to.properties.push(idx);
      const prop = this.getPropertyState(idx)!;
      prop.ownerId = to.id;
    }
    for (const idx of trade.requestedProperties) {
      to.properties = to.properties.filter(p => p !== idx);
      from.properties.push(idx);
      const prop = this.getPropertyState(idx)!;
      prop.ownerId = from.id;
    }

    // Transfer money
    from.money -= trade.offeredMoney;
    to.money += trade.offeredMoney;
    to.money -= trade.requestedMoney;
    from.money += trade.requestedMoney;

    // Transfer jail cards
    from.jailCardCount -= trade.offeredJailCards;
    to.jailCardCount += trade.offeredJailCards;
    to.jailCardCount -= trade.requestedJailCards;
    from.jailCardCount += trade.requestedJailCards;

    this.state.activeTrade = null;
    this.addLog(null, 'trade', `${from.name} and ${to.name} completed a trade.`);
    this.touch();
  }

  cancelTrade(): void {
    this.state.activeTrade = null;
    this.touch();
  }

  // ── Auction ─────────────────────────────────────────────────────────────────

  startAuction(spaceIndex: number, bidderIds: string[]): AuctionState {
    const auction: AuctionState = {
      spaceIndex,
      currentHighBid: 0,
      currentHighBidderId: null,
      activeBidderIds: [...bidderIds],
      status: 'active',
    };
    this.state.turn.auctionState = auction;
    this.touch();
    return auction;
  }

  placeBid(playerId: string, amount: number): void {
    const auction = this.state.turn.auctionState!;
    auction.currentHighBid = amount;
    auction.currentHighBidderId = playerId;
    this.touch();
  }

  removeFromAuction(playerId: string): void {
    const auction = this.state.turn.auctionState!;
    auction.activeBidderIds = auction.activeBidderIds.filter(id => id !== playerId);
    this.touch();
  }

  completeAuction(): { winnerId: string | null; amount: number; spaceIndex: number } {
    const auction = this.state.turn.auctionState!;
    auction.status = 'complete';

    const result = {
      winnerId: auction.currentHighBidderId,
      amount: auction.currentHighBid,
      spaceIndex: auction.spaceIndex,
    };

    if (result.winnerId) {
      const space = BOARD_SPACES.find(s => s.index === result.spaceIndex)!;
      const player = this.getPlayer(result.winnerId)!;
      const prop = this.getPropertyState(result.spaceIndex)!;

      player.money -= result.amount;
      player.properties.push(result.spaceIndex);
      prop.ownerId = result.winnerId;

      this.addLog(result.winnerId, 'action', `${player.name} won ${space.name} at auction for £${result.amount}.`);
    }

    this.state.turn.auctionState = null;
    this.touch();
    return result;
  }

  // ── Turn management ─────────────────────────────────────────────────────────

  advanceTurn(): string {
    const players = this.activePlayers;
    const currentIdx = players.findIndex(p => p.id === this.state.turn.currentPlayerId);
    const nextIdx = (currentIdx + 1) % players.length;
    const nextPlayer = players[nextIdx];

    this.state.turn = {
      currentPlayerId: nextPlayer.id,
      phase: 'waiting',
      diceValues: null,
      doublesCount: 0,
      hasRolled: false,
      mustPayRent: false,
      rentAmount: null,
      rentOwnerId: null,
      pendingCard: null,
      auctionState: null,
    };

    this.addLog(null, 'system', `It's ${nextPlayer.name}'s turn.`);
    this.touch();
    return nextPlayer.id;
  }

  /** Reset turn for another roll (doubles) */
  resetForDoubles(): void {
    this.state.turn.phase = 'waiting';
    this.state.turn.diceValues = null;
    this.state.turn.hasRolled = false;
    this.state.turn.mustPayRent = false;
    this.state.turn.rentAmount = null;
    this.state.turn.rentOwnerId = null;
    this.state.turn.pendingCard = null;
    this.touch();
  }

  // ── Bankruptcy ──────────────────────────────────────────────────────────────

  declareBankruptcy(playerId: string, creditorId: string | null): void {
    const player = this.getPlayer(playerId)!;
    player.isBankrupt = true;

    if (creditorId) {
      // Transfer all assets to creditor
      const creditor = this.getPlayer(creditorId)!;
      creditor.money += Math.max(0, player.money);
      for (const idx of player.properties) {
        creditor.properties.push(idx);
        const prop = this.getPropertyState(idx)!;
        prop.ownerId = creditorId;
      }
      creditor.jailCardCount += player.jailCardCount;
      this.addLog(playerId, 'system', `${player.name} went bankrupt! All assets transferred to ${creditor.name}.`);
    } else {
      // Bank gets everything — properties return to unowned, buildings removed
      for (const idx of player.properties) {
        const prop = this.getPropertyState(idx)!;
        prop.ownerId = null;
        prop.houses = 0;
        prop.hasHotel = false;
        prop.isMortgaged = false;
      }
      this.addLog(playerId, 'system', `${player.name} went bankrupt! All properties returned to the bank.`);
    }

    player.money = 0;
    player.properties = [];
    player.jailCardCount = 0;

    // Check for game over
    if (this.activePlayers.length === 1) {
      this.state.status = 'game-over';
      this.state.winnerId = this.activePlayers[0].id;
      this.addLog(null, 'system', `${this.activePlayers[0].name} wins the game!`);
    }

    this.touch();
  }

  // ── Logging ─────────────────────────────────────────────────────────────────

  addLog(playerId: string | null, type: GameLogType, message: string): void {
    const entry: GameLogEntry = {
      timestamp: Date.now(),
      playerId,
      message,
      type,
    };
    this.state.log.push(entry);
    // Keep log manageable — trim to last 100 entries
    if (this.state.log.length > 100) {
      this.state.log = this.state.log.slice(-100);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private touch(): void {
    this.state.lastActionAt = Date.now();
  }

  private initProperties(): PropertyState[] {
    return PURCHASABLE_SPACES.map(index => ({
      spaceIndex: index,
      ownerId: null,
      houses: 0,
      hasHotel: false,
      isMortgaged: false,
    }));
  }

  private emptyTurn(): TurnState {
    return {
      currentPlayerId: '',
      phase: 'waiting',
      diceValues: null,
      doublesCount: 0,
      hasRolled: false,
      mustPayRent: false,
      rentAmount: null,
      rentOwnerId: null,
      pendingCard: null,
      auctionState: null,
    };
  }
}
