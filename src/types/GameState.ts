// ─── Enums ────────────────────────────────────────────────────────────────────

export type SpaceType =
  | 'go'
  | 'property'
  | 'railroad'
  | 'utility'
  | 'tax'
  | 'jail'
  | 'free-parking'
  | 'go-to-jail'
  | 'community-chest'
  | 'chance';

export type ColorGroup =
  | 'brown'
  | 'light-blue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'dark-blue'
  | 'railroad'
  | 'utility';

export type TokenType =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'cyan'
  | 'pink';

export type TurnPhase =
  | 'waiting'
  | 'rolling'
  | 'moving'
  | 'landing'
  | 'action'
  | 'end';

export type GameStatus = 'lobby' | 'starting' | 'in-progress' | 'game-over';

export type CardDeck = 'chance' | 'community-chest';

export type CardEffectType =
  | 'advance-to'        // move to specific space index
  | 'advance-nearest'   // move to nearest railroad or utility
  | 'move-back'         // go back N spaces
  | 'money'             // gain or lose money
  | 'money-per-building'// pay per house/hotel
  | 'money-from-players'// collect from each player
  | 'jail'              // go to jail
  | 'jail-free';        // get out of jail free card

// ─── Board Space ──────────────────────────────────────────────────────────────

export interface BoardSpace {
  index: number;
  type: SpaceType;
  name: string;
  // Property / Railroad / Utility only
  price?: number;
  colorGroup?: ColorGroup;
  cardFrame?: number;         // spritesheet frame index (0–27) for deed display
  rents?: number[];           // [base, 1h, 2h, 3h, 4h, hotel] — property only
  railroadRents?: number[];   // [1 owned, 2, 3, 4] — railroad only
  utilityMultipliers?: number[]; // [1 owned = 4x, 2 owned = 10x] — utility only
  houseCost?: number;
  mortgageValue?: number;
  // Tax only
  taxAmount?: number;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

export interface CardEffect {
  type: CardEffectType;
  value?: number;             // amount, spaces, or target space index
  targetType?: 'railroad' | 'utility'; // for advance-nearest
  perHouse?: number;          // for money-per-building
  perHotel?: number;          // for money-per-building
}

export interface GameCard {
  id: number;
  deck: CardDeck;
  description: string;
  effect: CardEffect;
}

export interface DrawnCard {
  deck: CardDeck;
  cardId: number;
  description: string;
  effect: CardEffect;
}

// ─── Trade ────────────────────────────────────────────────────────────────────

export type TradeStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'cancelled';

export interface TradeOffer {
  tradeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  offeredProperties: number[];    // space indices
  requestedProperties: number[];  // space indices
  offeredMoney: number;
  requestedMoney: number;
  offeredJailCards: number;
  requestedJailCards: number;
  status: TradeStatus;
}

// ─── Auction ──────────────────────────────────────────────────────────────────

export interface AuctionState {
  spaceIndex: number;
  currentHighBid: number;
  currentHighBidderId: string | null;
  activeBidderIds: string[];
  status: 'active' | 'complete';
}

// ─── Player ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  token: TokenType;
  position: number;           // 0–39 board space index
  money: number;
  properties: number[];       // owned space indices
  isJailed: boolean;
  jailTurns: number;          // 0–3 turns spent in jail
  jailCardCount: number;      // Get Out of Jail Free cards held
  isBankrupt: boolean;
  isConnected: boolean;
  isHost: boolean;
  isReady: boolean;
  reconnectToken: string;     // stored in client localStorage for rejoin
}

// ─── Property State ───────────────────────────────────────────────────────────

export interface PropertyState {
  spaceIndex: number;
  ownerId: string | null;
  houses: number;             // 0–4
  hasHotel: boolean;
  isMortgaged: boolean;
}

// ─── Turn State ───────────────────────────────────────────────────────────────

export interface TurnState {
  currentPlayerId: string;
  phase: TurnPhase;
  diceValues: [number, number] | null;
  doublesCount: number;       // 0–2; third double = go to jail
  hasRolled: boolean;
  mustPayRent: boolean;
  rentAmount: number | null;
  rentOwnerId: string | null;
  pendingCard: DrawnCard | null;
  auctionState: AuctionState | null;
}

// ─── Game Log ─────────────────────────────────────────────────────────────────

export type GameLogType = 'action' | 'system' | 'card' | 'trade';

export interface GameLogEntry {
  timestamp: number;
  playerId: string | null;    // null for system messages
  message: string;
  type: GameLogType;
}

// ─── Game Config ──────────────────────────────────────────────────────────────

export interface GameConfig {
  maxPlayers: number;
  startingMoney: number;
  // Extensible special rules — add new rules here as boolean flags
  specialRules: Record<string, boolean>;
}

// ─── Master Game State ────────────────────────────────────────────────────────

export interface GameState {
  roomCode: string;
  status: GameStatus;
  players: Player[];                  // ordered by turn
  properties: PropertyState[];        // all 28 purchasable spaces
  communityChestDeck: number[];       // shuffled card id array — draw from front
  chanceDeck: number[];
  communityChestDiscard: number[];
  chanceDiscard: number[];
  turn: TurnState;
  activeTrade: TradeOffer | null;
  log: GameLogEntry[];
  config: GameConfig;
  winnerId: string | null;
  createdAt: number;
  lastActionAt: number;
}
