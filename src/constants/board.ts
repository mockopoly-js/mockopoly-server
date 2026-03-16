import type { BoardSpace, GameCard } from '../types/GameState';

// ─── Board Spaces (0–39) ──────────────────────────────────────────────────────
// Standard UK Monopoly layout starting from GO (index 0), moving clockwise.
// cardFrame is the spritesheet index (0–27) matching property_cards.png row-major order.

export const BOARD_SPACES: BoardSpace[] = [
  // ── Bottom row: GO → Jail ──────────────────────────────────────────────────
  { index: 0,  type: 'go',            name: 'GO' },
  { index: 1,  type: 'property',      name: 'Old Kent Road',        price: 60,  colorGroup: 'brown',     cardFrame: 1,  rents: [2,10,30,90,160,250],    houseCost: 50,  mortgageValue: 30 },
  { index: 2,  type: 'community-chest', name: 'Community Chest' },
  { index: 3,  type: 'property',      name: 'Whitechapel Road',     price: 60,  colorGroup: 'brown',     cardFrame: 0,  rents: [4,20,60,180,320,450],    houseCost: 50,  mortgageValue: 30 },
  { index: 4,  type: 'tax',           name: 'Income Tax',           taxAmount: 200 },
  { index: 5,  type: 'railroad',      name: 'Kings Cross Station',  price: 200, colorGroup: 'railroad',  cardFrame: 5,  railroadRents: [25,50,100,200],  mortgageValue: 100 },
  { index: 6,  type: 'property',      name: 'The Angle Islington',  price: 100, colorGroup: 'light-blue',cardFrame: 2,  rents: [6,30,90,270,400,550],    houseCost: 50,  mortgageValue: 50 },
  { index: 7,  type: 'chance',        name: 'Chance' },
  { index: 8,  type: 'property',      name: 'Euston Road',          price: 100, colorGroup: 'light-blue',cardFrame: 3,  rents: [6,30,90,270,400,550],    houseCost: 50,  mortgageValue: 50 },
  { index: 9,  type: 'property',      name: 'Pentonville Road',     price: 120, colorGroup: 'light-blue',cardFrame: 4,  rents: [8,40,100,300,450,600],   houseCost: 50,  mortgageValue: 60 },

  // ── Left column: Jail → Free Parking ──────────────────────────────────────
  { index: 10, type: 'jail',          name: 'Jail / Just Visiting' },
  { index: 11, type: 'property',      name: 'Pall Mall',            price: 140, colorGroup: 'pink',      cardFrame: 7,  rents: [10,50,150,450,625,750],  houseCost: 100, mortgageValue: 70 },
  { index: 12, type: 'utility',       name: 'Electric Company',     price: 150, colorGroup: 'utility',   cardFrame: 25, utilityMultipliers: [4, 10],      mortgageValue: 75 },
  { index: 13, type: 'property',      name: 'Whitehall',            price: 140, colorGroup: 'pink',      cardFrame: 8,  rents: [10,50,150,450,625,750],  houseCost: 100, mortgageValue: 70 },
  { index: 14, type: 'property',      name: 'Northumberland Avenue',price: 160, colorGroup: 'pink',      cardFrame: 9,  rents: [12,60,180,500,700,900],  houseCost: 100, mortgageValue: 80 },
  { index: 15, type: 'railroad',      name: 'Marylebone Station',   price: 200, colorGroup: 'railroad',  cardFrame: 6,  railroadRents: [25,50,100,200],  mortgageValue: 100 },
  { index: 16, type: 'property',      name: 'Bow Street',           price: 180, colorGroup: 'orange',    cardFrame: 10, rents: [14,70,200,550,750,950],  houseCost: 100, mortgageValue: 90 },
  { index: 17, type: 'community-chest', name: 'Community Chest' },
  { index: 18, type: 'property',      name: 'Marlborough Street',   price: 180, colorGroup: 'orange',    cardFrame: 11, rents: [14,70,200,550,750,950],  houseCost: 100, mortgageValue: 90 },
  { index: 19, type: 'property',      name: 'Vine Street',          price: 200, colorGroup: 'orange',    cardFrame: 12, rents: [16,80,220,600,800,1000], houseCost: 100, mortgageValue: 100 },

  // ── Top row: Free Parking → Go To Jail ────────────────────────────────────
  { index: 20, type: 'free-parking',  name: 'Free Parking' },
  { index: 21, type: 'property',      name: 'Strand',               price: 220, colorGroup: 'red',       cardFrame: 14, rents: [18,90,250,700,875,1050], houseCost: 150, mortgageValue: 110 },
  { index: 22, type: 'chance',        name: 'Chance' },
  { index: 23, type: 'property',      name: 'Fleet Street',         price: 220, colorGroup: 'red',       cardFrame: 15, rents: [18,90,250,700,875,1050], houseCost: 150, mortgageValue: 110 },
  { index: 24, type: 'property',      name: 'Trafalgar Square',     price: 240, colorGroup: 'red',       cardFrame: 16, rents: [20,100,300,750,925,1100],houseCost: 150, mortgageValue: 120 },
  { index: 25, type: 'railroad',      name: 'Fenchurch St. Station',price: 200, colorGroup: 'railroad',  cardFrame: 13, railroadRents: [25,50,100,200],  mortgageValue: 100 },
  { index: 26, type: 'property',      name: 'Leicester Square',     price: 260, colorGroup: 'yellow',    cardFrame: 17, rents: [22,110,330,800,975,1150], houseCost: 150, mortgageValue: 130 },
  { index: 27, type: 'property',      name: 'Coventry Street',      price: 260, colorGroup: 'yellow',    cardFrame: 18, rents: [22,110,330,800,975,1150], houseCost: 150, mortgageValue: 130 },
  { index: 28, type: 'utility',       name: 'Water Works',          price: 150, colorGroup: 'utility',   cardFrame: 26, utilityMultipliers: [4, 10],      mortgageValue: 75 },
  { index: 29, type: 'property',      name: 'Piccadilly',           price: 280, colorGroup: 'yellow',    cardFrame: 19, rents: [24,120,360,850,1025,1200],houseCost: 150, mortgageValue: 140 },

  // ── Right column: Go To Jail → GO ─────────────────────────────────────────
  { index: 30, type: 'go-to-jail',    name: 'Go To Jail' },
  { index: 31, type: 'property',      name: 'Regent Street',        price: 300, colorGroup: 'green',     cardFrame: 21, rents: [26,130,390,900,1100,1275],houseCost: 200, mortgageValue: 150 },
  { index: 32, type: 'property',      name: 'Oxford Street',        price: 300, colorGroup: 'green',     cardFrame: 22, rents: [26,130,390,900,1100,1275],houseCost: 200, mortgageValue: 150 },
  { index: 33, type: 'community-chest', name: 'Community Chest' },
  { index: 34, type: 'property',      name: 'Bond Street',          price: 320, colorGroup: 'green',     cardFrame: 23, rents: [28,150,450,1000,1200,1400],houseCost: 200, mortgageValue: 160 },
  { index: 35, type: 'railroad',      name: 'Liverpool St. Station',price: 200, colorGroup: 'railroad',  cardFrame: 20, railroadRents: [25,50,100,200],  mortgageValue: 100 },
  { index: 36, type: 'chance',        name: 'Chance' },
  { index: 37, type: 'property',      name: 'Park Lane',            price: 350, colorGroup: 'dark-blue', cardFrame: 24, rents: [35,175,500,1100,1300,1500],houseCost: 200, mortgageValue: 175 },
  { index: 38, type: 'tax',           name: 'Luxury Tax',           taxAmount: 100 },
  { index: 39, type: 'property',      name: 'Mayfair',              price: 400, colorGroup: 'dark-blue', cardFrame: 27, rents: [50,200,600,1400,1700,2000],houseCost: 200, mortgageValue: 200 },
];

// Quick lookup map by space index
export const SPACE_MAP = new Map<number, BoardSpace>(
  BOARD_SPACES.map(s => [s.index, s])
);

// All purchasable space indices
export const PURCHASABLE_SPACES = BOARD_SPACES
  .filter(s => s.type === 'property' || s.type === 'railroad' || s.type === 'utility')
  .map(s => s.index);

// Space indices grouped by color
export const COLOR_GROUPS: Record<string, number[]> = BOARD_SPACES
  .filter(s => s.colorGroup)
  .reduce((acc, s) => {
    const g = s.colorGroup!;
    if (!acc[g]) acc[g] = [];
    acc[g].push(s.index);
    return acc;
  }, {} as Record<string, number[]>);

// ─── Community Chest Cards (16) ───────────────────────────────────────────────

export const COMMUNITY_CHEST_CARDS: GameCard[] = [
  { id: 0,  deck: 'community-chest', description: 'Advance to Go — collect £200.',                                           effect: { type: 'advance-to', value: 0 } },
  { id: 1,  deck: 'community-chest', description: 'Bank error in your favour — collect £200.',                               effect: { type: 'money', value: 200 } },
  { id: 2,  deck: 'community-chest', description: "Doctor's fee — pay £50.",                                                 effect: { type: 'money', value: -50 } },
  { id: 3,  deck: 'community-chest', description: 'From sale of stock — collect £50.',                                       effect: { type: 'money', value: 50 } },
  { id: 4,  deck: 'community-chest', description: 'Get Out of Jail Free.',                                                   effect: { type: 'jail-free' } },
  { id: 5,  deck: 'community-chest', description: 'Go to Jail — go directly to jail.',                                       effect: { type: 'jail' } },
  { id: 6,  deck: 'community-chest', description: 'Holiday fund matures — collect £100.',                                    effect: { type: 'money', value: 100 } },
  { id: 7,  deck: 'community-chest', description: 'Income tax refund — collect £20.',                                        effect: { type: 'money', value: 20 } },
  { id: 8,  deck: 'community-chest', description: 'It is your birthday — collect £10 from every player.',                   effect: { type: 'money-from-players', value: 10 } },
  { id: 9,  deck: 'community-chest', description: 'Life insurance matures — collect £100.',                                  effect: { type: 'money', value: 100 } },
  { id: 10, deck: 'community-chest', description: 'Pay hospital fees — pay £100.',                                           effect: { type: 'money', value: -100 } },
  { id: 11, deck: 'community-chest', description: 'Pay school fees — pay £150.',                                             effect: { type: 'money', value: -150 } },
  { id: 12, deck: 'community-chest', description: 'Receive £25 consultancy fee.',                                            effect: { type: 'money', value: 25 } },
  { id: 13, deck: 'community-chest', description: 'You are assessed for street repairs — pay £40 per house, £115 per hotel.',effect: { type: 'money-per-building', perHouse: 40, perHotel: 115 } },
  { id: 14, deck: 'community-chest', description: 'You have won second prize in a beauty contest — collect £10.',            effect: { type: 'money', value: 10 } },
  { id: 15, deck: 'community-chest', description: 'You inherit £100.',                                                       effect: { type: 'money', value: 100 } },
];

// ─── Chance Cards (16) ────────────────────────────────────────────────────────

export const CHANCE_CARDS: GameCard[] = [
  { id: 0,  deck: 'chance', description: 'Advance to Go — collect £200.',                                                      effect: { type: 'advance-to', value: 0 } },
  { id: 1,  deck: 'chance', description: 'Advance to Trafalgar Square — if you pass Go collect £200.',                         effect: { type: 'advance-to', value: 24 } },
  { id: 2,  deck: 'chance', description: 'Advance to Mayfair.',                                                                effect: { type: 'advance-to', value: 39 } },
  { id: 3,  deck: 'chance', description: 'Advance to Pall Mall — if you pass Go collect £200.',                                effect: { type: 'advance-to', value: 11 } },
  { id: 4,  deck: 'chance', description: 'Advance to nearest utility. If unowned you may buy. If owned pay 10× dice roll.',    effect: { type: 'advance-nearest', targetType: 'utility' } },
  { id: 5,  deck: 'chance', description: 'Advance to nearest railway. If unowned you may buy. If owned pay 2× normal rent.',   effect: { type: 'advance-nearest', targetType: 'railroad' } },
  { id: 6,  deck: 'chance', description: 'Bank pays you a dividend of £50.',                                                   effect: { type: 'money', value: 50 } },
  { id: 7,  deck: 'chance', description: 'Get Out of Jail Free.',                                                              effect: { type: 'jail-free' } },
  { id: 8,  deck: 'chance', description: 'Go back 3 spaces.',                                                                  effect: { type: 'move-back', value: 3 } },
  { id: 9,  deck: 'chance', description: 'Go to Jail — go directly to jail.',                                                  effect: { type: 'jail' } },
  { id: 10, deck: 'chance', description: 'Make general repairs on all your properties — pay £25 per house, £100 per hotel.',   effect: { type: 'money-per-building', perHouse: 25, perHotel: 100 } },
  { id: 11, deck: 'chance', description: 'Speeding fine — pay £15.',                                                           effect: { type: 'money', value: -15 } },
  { id: 12, deck: 'chance', description: 'Take a trip to Kings Cross Station — if you pass Go collect £200.',                  effect: { type: 'advance-to', value: 5 } },
  { id: 13, deck: 'chance', description: 'You have been elected Chairman of the Board — pay each player £50.',                 effect: { type: 'money-from-players', value: -50 } },
  { id: 14, deck: 'chance', description: 'Your building loan matures — collect £150.',                                         effect: { type: 'money', value: 150 } },
  { id: 15, deck: 'chance', description: 'You are assessed for street repairs — pay £40 per house, £115 per hotel.',           effect: { type: 'money-per-building', perHouse: 40, perHotel: 115 } },
];

// Card lookup maps
export const COMMUNITY_CHEST_MAP = new Map<number, GameCard>(
  COMMUNITY_CHEST_CARDS.map(c => [c.id, c])
);
export const CHANCE_MAP = new Map<number, GameCard>(
  CHANCE_CARDS.map(c => [c.id, c])
);
