import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, PropertyState, TurnState, GameLogEntry,
  GameLogType, TokenType, DrawnCard, TradeOffer, AuctionState,
  Partnership, PartnershipProposal, PartnershipDissolutionRequest,
  PartnershipEquity, RentDeal, ColorGroup,
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
      partnerships: [],
      activePartnershipProposal: null,
      activePartnershipDissolution: null,
      freeParkingPool: 0,
      activeRentDeal: null,
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
      goDeductionsUsed: 0, goSkipsRemaining: 0,
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
      if (player.goSkipsRemaining > 0) {
        player.goSkipsRemaining--;
        this.addLog(playerId, 'action', `${player.name} passed GO but salary is skipped (GO deduction — ${player.goSkipsRemaining} skips remaining).`);
      } else {
        player.money += RULES.GO_SALARY;
        this.addLog(playerId, 'action', `${player.name} passed GO and collected £${RULES.GO_SALARY}.`);
      }
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
      if (player.goSkipsRemaining > 0) {
        player.goSkipsRemaining--;
        this.addLog(playerId, 'action', `${player.name} passed GO but salary is skipped (GO deduction — ${player.goSkipsRemaining} skips remaining).`);
      } else {
        player.money += RULES.GO_SALARY;
        this.addLog(playerId, 'action', `${player.name} passed GO and collected £${RULES.GO_SALARY}.`);
      }
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
    const refund = space.houseCost!;

    prop.houses--;
    player.money += refund;

    this.addLog(playerId, 'action', `${player.name} sold a house on ${space.name} for £${refund}.`);
    this.touch();
  }

  sellHotel(playerId: string, spaceIndex: number): void {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    const prop = this.getPropertyState(spaceIndex)!;
    const player = this.getPlayer(playerId)!;
    const refund = space.houseCost!;

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
    this.addToFreeParking(amount);
    this.addLog(playerId, 'action', `${player.name} paid £${amount} tax (added to Free Parking pool).`);
    this.touch();
  }

  // ── Free Parking Pool ─────────────────────────────────────────────────────

  addToFreeParking(amount: number): void {
    this.state.freeParkingPool += amount;
    this.touch();
  }

  collectFreeParking(playerId: string): number {
    const amount = this.state.freeParkingPool;
    if (amount <= 0) return 0;

    const player = this.getPlayer(playerId)!;
    player.money += amount;
    this.state.freeParkingPool = 0;
    this.addLog(playerId, 'action', `${player.name} collected £${amount} from Free Parking!`);
    this.touch();
    return amount;
  }

  // ── GO Deduction ──────────────────────────────────────────────────────────

  goDeduction(playerId: string, count: number): number {
    const player = this.getPlayer(playerId)!;
    const amount = count * RULES.GO_SALARY;

    player.money += amount;
    player.goDeductionsUsed += count;
    player.goSkipsRemaining += count;

    this.addLog(playerId, 'action', `${player.name} took a GO deduction of £${amount} (${player.goDeductionsUsed}/5 used).`);
    this.touch();
    return amount;
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
    if (players.length === 0) return this.state.turn.currentPlayerId;
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

  // ── Partnership ────────────────────────────────────────────────────────────

  createPartnershipProposal(proposal: PartnershipProposal): void {
    this.state.activePartnershipProposal = proposal;
    this.touch();
  }

  acceptPartnershipProposal(playerId: string): boolean {
    const proposal = this.state.activePartnershipProposal;
    if (!proposal) return false;

    if (!proposal.acceptedPlayerIds.includes(playerId)) {
      proposal.acceptedPlayerIds.push(playerId);
    }

    // Check if all proposed partners have accepted
    const allAccepted = proposal.proposedEquity.every(
      eq => proposal.acceptedPlayerIds.includes(eq.playerId)
    );

    if (allAccepted) {
      proposal.status = 'accepted';
      this.formPartnership(proposal);
      this.state.activePartnershipProposal = null;
      return true; // partnership formed
    }

    this.touch();
    return false; // still waiting
  }

  rejectPartnershipProposal(): void {
    if (this.state.activePartnershipProposal) {
      this.state.activePartnershipProposal.status = 'rejected';
      this.state.activePartnershipProposal = null;
    }
    this.touch();
  }

  cancelPartnershipProposal(): void {
    if (this.state.activePartnershipProposal) {
      this.state.activePartnershipProposal.status = 'cancelled';
      this.state.activePartnershipProposal = null;
    }
    this.touch();
  }

  private formPartnership(proposal: PartnershipProposal): Partnership {
    const partnership: Partnership = {
      partnershipId: uuid(),
      colorGroup: proposal.colorGroup,
      partners: proposal.proposedEquity.map(eq => ({ ...eq })),
      status: 'active',
      createdAt: Date.now(),
    };
    this.state.partnerships.push(partnership);
    this.addLog(null, 'partnership', `Partnership formed on ${proposal.colorGroup} zone!`);
    this.touch();
    return partnership;
  }

  getPartnershipForGroup(colorGroup: ColorGroup): Partnership | undefined {
    return this.state.partnerships.find(
      p => p.colorGroup === colorGroup && p.status === 'active'
    );
  }

  getPartnershipById(partnershipId: string): Partnership | undefined {
    return this.state.partnerships.find(p => p.partnershipId === partnershipId);
  }

  isPropertyInPartnership(spaceIndex: number): boolean {
    const space = BOARD_SPACES.find(s => s.index === spaceIndex);
    if (!space || !space.colorGroup) return false;
    return !!this.getPartnershipForGroup(space.colorGroup);
  }

  createDissolutionRequest(request: PartnershipDissolutionRequest): void {
    this.state.activePartnershipDissolution = request;
    this.touch();
  }

  acceptDissolution(playerId: string): boolean {
    const req = this.state.activePartnershipDissolution;
    if (!req) return false;

    if (!req.acceptedPlayerIds.includes(playerId)) {
      req.acceptedPlayerIds.push(playerId);
    }

    const partnership = this.getPartnershipById(req.partnershipId);
    if (!partnership) return false;

    const allAccepted = partnership.partners.every(
      p => req.acceptedPlayerIds.includes(p.playerId)
    );

    if (allAccepted) {
      req.status = 'accepted';
      this.dissolvePartnership(partnership);
      this.state.activePartnershipDissolution = null;
      return true;
    }

    this.touch();
    return false;
  }

  rejectDissolution(): void {
    if (this.state.activePartnershipDissolution) {
      this.state.activePartnershipDissolution.status = 'rejected';
      this.state.activePartnershipDissolution = null;
    }
    this.touch();
  }

  dissolvePartnership(partnership: Partnership): { playerId: string; amount: number }[] {
    const group = COLOR_GROUPS[partnership.colorGroup];
    const refunds: { playerId: string; amount: number }[] = [];

    // Sell all buildings and split refund by equity
    let totalBuildingValue = 0;
    for (const idx of group) {
      const prop = this.getPropertyState(idx)!;
      const space = BOARD_SPACES.find(s => s.index === idx)!;

      if (prop.hasHotel) {
        totalBuildingValue += space.houseCost! * 5; // 4 houses + hotel
        prop.hasHotel = false;
      }
      totalBuildingValue += prop.houses * space.houseCost!;
      prop.houses = 0;
    }

    // Split refund by equity
    if (totalBuildingValue > 0) {
      let distributed = 0;
      const sorted = [...partnership.partners].sort((a, b) => b.percentage - a.percentage);
      for (let i = 0; i < sorted.length; i++) {
        const share = i === 0
          ? totalBuildingValue - distributed // remainder to highest
          : Math.floor(totalBuildingValue * sorted[i].percentage / 100);
        if (i !== 0) distributed += share;
        else {
          // Calculate others first
          let othersTotal = 0;
          for (let j = 1; j < sorted.length; j++) {
            othersTotal += Math.floor(totalBuildingValue * sorted[j].percentage / 100);
          }
          const highestShare = totalBuildingValue - othersTotal;
          const player = this.getPlayer(sorted[0].playerId);
          if (player) player.money += highestShare;
          refunds.push({ playerId: sorted[0].playerId, amount: highestShare });
          distributed = othersTotal;
          continue;
        }
        const player = this.getPlayer(sorted[i].playerId);
        if (player) player.money += share;
        refunds.push({ playerId: sorted[i].playerId, amount: share });
      }
    }

    partnership.status = 'pending'; // mark inactive
    this.state.partnerships = this.state.partnerships.filter(
      p => p.partnershipId !== partnership.partnershipId
    );

    this.addLog(null, 'partnership', `Partnership on ${partnership.colorGroup} zone dissolved.`);
    this.touch();
    return refunds;
  }

  /** Split rent among partnership partners by equity */
  collectPartnershipRent(
    fromId: string, spaceIndex: number, totalRent: number, partnership: Partnership,
  ): { playerId: string; amount: number }[] {
    const from = this.getPlayer(fromId)!;
    from.money -= totalRent;

    const splits: { playerId: string; amount: number }[] = [];
    const sorted = [...partnership.partners].sort((a, b) => b.percentage - a.percentage);
    let distributed = 0;

    for (let i = sorted.length - 1; i >= 0; i--) {
      const share = i === 0
        ? totalRent - distributed // remainder to highest equity
        : Math.floor(totalRent * sorted[i].percentage / 100);
      distributed += share;

      const partner = this.getPlayer(sorted[i].playerId);
      if (partner) partner.money += share;
      splits.push({ playerId: sorted[i].playerId, amount: share });
    }

    const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;
    this.addLog(fromId, 'action', `${from.name} paid £${totalRent} rent on ${space.name} (split among partners).`);
    this.touch();
    return splits;
  }

  /** Handle partner bankruptcy — transfer properties and redistribute equity */
  handlePartnerBankruptcy(playerId: string): void {
    const partnershipsCopy = [...this.state.partnerships];

    for (const partnership of partnershipsCopy) {
      if (partnership.status !== 'active') continue;
      const partnerIdx = partnership.partners.findIndex(p => p.playerId === playerId);
      if (partnerIdx === -1) continue;

      const group = COLOR_GROUPS[partnership.colorGroup];
      const bankruptPartner = partnership.partners[partnerIdx];
      const remaining = partnership.partners.filter(p => p.playerId !== playerId);

      if (remaining.length === 1) {
        // 2-player partnership: surviving partner gets full ownership
        const survivor = this.getPlayer(remaining[0].playerId);
        if (survivor) {
          for (const idx of group) {
            const prop = this.getPropertyState(idx)!;
            if (prop.ownerId === playerId) {
              prop.ownerId = survivor.id;
              survivor.properties.push(idx);
            }
          }
        }
        this.state.partnerships = this.state.partnerships.filter(
          p => p.partnershipId !== partnership.partnershipId
        );
        this.addLog(null, 'partnership', `${remaining[0].playerId} inherited ${partnership.colorGroup} zone properties.`);
      } else {
        // 3-player partnership: redistribute equity
        const totalRemaining = remaining.reduce((sum, p) => sum + p.percentage, 0);
        for (const p of remaining) {
          p.percentage = Math.round(p.percentage / totalRemaining * 100);
        }
        // Fix rounding — ensure sum is 100
        const sum = remaining.reduce((s, p) => s + p.percentage, 0);
        if (sum !== 100) remaining[0].percentage += 100 - sum;

        partnership.partners = remaining;

        // Transfer bankrupt player's properties to remaining partners (distribute)
        for (const idx of group) {
          const prop = this.getPropertyState(idx)!;
          if (prop.ownerId === playerId) {
            // Give to highest equity partner
            const highest = remaining.sort((a, b) => b.percentage - a.percentage)[0];
            const newOwner = this.getPlayer(highest.playerId);
            if (newOwner) {
              prop.ownerId = newOwner.id;
              newOwner.properties.push(idx);
            }
          }
        }
        this.addLog(null, 'partnership', `Partnership on ${partnership.colorGroup} zone restructured after bankruptcy.`);
      }
    }

    this.touch();
  }

  // ── Rent Deal ─────────────────────────────────────────────────────────────

  createRentDeal(deal: RentDeal): void {
    this.state.activeRentDeal = deal;
    this.touch();
  }

  acceptRentDeal(playerId: string): boolean {
    const deal = this.state.activeRentDeal;
    if (!deal) return false;

    if (!deal.acceptedPlayerIds.includes(playerId)) {
      deal.acceptedPlayerIds.push(playerId);
    }

    // When last offer was by debtor → all creditors must accept
    // When last offer was by a creditor → debtor must accept
    const lastByDebtor = deal.lastOfferBy === deal.debtorId;
    let allAccepted: boolean;
    if (lastByDebtor) {
      allAccepted = deal.creditorIds.every(id => deal.acceptedPlayerIds.includes(id));
    } else {
      allAccepted = deal.acceptedPlayerIds.includes(deal.debtorId);
    }

    if (allAccepted) {
      deal.status = 'accepted';
      this.executeRentDeal(deal);
      this.state.activeRentDeal = null;
      return true;
    }

    this.touch();
    return false;
  }

  rejectRentDeal(): void {
    if (this.state.activeRentDeal) {
      this.state.activeRentDeal.status = 'rejected';
      this.state.activeRentDeal = null;
    }
    this.touch();
  }

  cancelRentDeal(): void {
    if (this.state.activeRentDeal) {
      this.state.activeRentDeal.status = 'cancelled';
      this.state.activeRentDeal = null;
    }
    this.touch();
  }

  counterRentDeal(newDeal: RentDeal): void {
    this.state.activeRentDeal = newDeal;
    this.touch();
  }

  private executeRentDeal(deal: RentDeal): void {
    const debtor = this.getPlayer(deal.debtorId)!;

    // Transfer offered properties to creditor(s)
    // If multiple creditors (partnership), properties go to first creditor for simplicity
    const primaryCreditor = this.getPlayer(deal.creditorIds[0])!;
    for (const idx of deal.offeredProperties) {
      debtor.properties = debtor.properties.filter(p => p !== idx);
      primaryCreditor.properties.push(idx);
      const prop = this.getPropertyState(idx)!;
      prop.ownerId = primaryCreditor.id;
    }

    // Transfer offered money to creditor(s), split by equity if partnership
    if (deal.offeredMoney > 0) {
      debtor.money -= deal.offeredMoney;
      if (deal.creditorIds.length === 1) {
        primaryCreditor.money += deal.offeredMoney;
      } else {
        // Split among partnership creditors
        const partnership = this.state.partnerships.find(p =>
          p.status === 'active' && p.partners.some(eq => eq.playerId === deal.creditorIds[0])
        );
        if (partnership) {
          let distributed = 0;
          const sorted = [...partnership.partners]
            .filter(p => deal.creditorIds.includes(p.playerId))
            .sort((a, b) => b.percentage - a.percentage);
          for (let i = sorted.length - 1; i >= 0; i--) {
            const share = i === 0
              ? deal.offeredMoney - distributed
              : Math.floor(deal.offeredMoney * sorted[i].percentage / 100);
            distributed += share;
            const creditor = this.getPlayer(sorted[i].playerId);
            if (creditor) creditor.money += share;
          }
        } else {
          // Fallback: split equally
          const perCreditor = Math.floor(deal.offeredMoney / deal.creditorIds.length);
          for (const cId of deal.creditorIds) {
            const creditor = this.getPlayer(cId);
            if (creditor) creditor.money += perCreditor;
          }
        }
      }
    }

    // Reduce pending rent by exempted amount
    if (deal.requestedExemption > 0 && this.state.turn.mustPayRent) {
      const remaining = (this.state.turn.rentAmount || 0) - deal.requestedExemption;
      if (remaining <= 0) {
        this.clearPendingRent();
      } else {
        this.state.turn.rentAmount = remaining;
      }
    }

    this.addLog(deal.debtorId, 'action', `Rent deal completed — £${deal.requestedExemption} exempted.`);
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
