import type { BoardSpace, GameCard } from '../types/GameState';

// ─── Board Spaces (0–39) ──────────────────────────────────────────────────────
// Standard UK Monopoly layout starting from GO (index 0), moving clockwise.
// cardFrame is the spritesheet index (0–27) matching property_cards.png row-major order.
// All money values are in thousands (K). E.g. price: 60000 = £60K on the cards.

export const BOARD_SPACES: BoardSpace[] = [
  // ── Bottom row: GO → Jail ──────────────────────────────────────────────────
  { index: 0,  type: 'go',            name: 'GO' },
  { index: 1,  type: 'property',      name: 'Old Kent Road',        price: 60000,  colorGroup: 'brown',     cardFrame: 1,  rents: [40000,100000,200000,600000,900000,1250000],    houseCost: 500000,  mortgageValue: 30000 },
  { index: 2,  type: 'community-chest', name: 'Community Chest' },
  { index: 3,  type: 'property',      name: 'Whitechapel Road',     price: 60000,  colorGroup: 'brown',     cardFrame: 0,  rents: [20000,100000,300000,900000,1600000,2500000],    houseCost: 500000,  mortgageValue: 30000 },
  { index: 4,  type: 'tax',           name: 'Income Tax',           taxAmount: 150000 },
  { index: 5,  type: 'railroad',      name: 'Kings Cross Station',  price: 200000, colorGroup: 'railroad',  cardFrame: 5,  railroadRents: [500000,1000000,1500000,2000000],  mortgageValue: 100000 },
  { index: 6,  type: 'property',      name: 'The Angle Islington',  price: 100000, colorGroup: 'light-blue',cardFrame: 2,  rents: [60000,120000,360000,800000,1100000,1300000],    houseCost: 500000,  mortgageValue: 50000 },
  { index: 7,  type: 'chance',        name: 'Chance' },
  { index: 8,  type: 'property',      name: 'Euston Road',          price: 100000, colorGroup: 'light-blue',cardFrame: 3,  rents: [60000,120000,360000,800000,1100000,1300000],    houseCost: 500000,  mortgageValue: 50000 },
  { index: 9,  type: 'property',      name: 'Pentonville Road',     price: 120000, colorGroup: 'light-blue',cardFrame: 4,  rents: [80000,150000,450000,1000000,1200000,1500000],   houseCost: 500000,  mortgageValue: 60000 },

  // ── Left column: Jail → Free Parking ──────────────────────────────────────
  { index: 10, type: 'jail',          name: 'Jail / Just Visiting' },
  { index: 11, type: 'property',      name: 'Pall Mall',            price: 140000, colorGroup: 'pink',      cardFrame: 7,  rents: [100000,500000,1500000,4500000,6250000,7500000],  houseCost: 1000000, mortgageValue: 70000 },
  { index: 12, type: 'utility',       name: 'Electric Company',     price: 150000, colorGroup: 'utility',   cardFrame: 25, utilityMultipliers: [4, 10],      mortgageValue: 75000 },
  { index: 13, type: 'property',      name: 'Whitehall',            price: 140000, colorGroup: 'pink',      cardFrame: 8,  rents: [100000,500000,1500000,4500000,6250000,7500000],  houseCost: 1000000, mortgageValue: 70000 },
  { index: 14, type: 'property',      name: 'Northumberland Avenue',price: 160000, colorGroup: 'pink',      cardFrame: 9,  rents: [120000,600000,1800000,5000000,7000000,9000000],  houseCost: 1000000, mortgageValue: 80000 },
  { index: 15, type: 'railroad',      name: 'Marylebone Station',   price: 200000, colorGroup: 'railroad',  cardFrame: 6,  railroadRents: [500000,1000000,1500000,2000000],  mortgageValue: 100000 },
  { index: 16, type: 'property',      name: 'Bow Street',           price: 180000, colorGroup: 'orange',    cardFrame: 10, rents: [140000,700000,2000000,5500000,7500000,9500000],  houseCost: 1000000, mortgageValue: 90000 },
  { index: 17, type: 'community-chest', name: 'Community Chest' },
  { index: 18, type: 'property',      name: 'Marlborough Street',   price: 180000, colorGroup: 'orange',    cardFrame: 11, rents: [140000,700000,2000000,5500000,7500000,9500000],  houseCost: 1000000, mortgageValue: 90000 },
  { index: 19, type: 'property',      name: 'Vine Street',          price: 200000, colorGroup: 'orange',    cardFrame: 12, rents: [160000,800000,2200000,6000000,8000000,10000000], houseCost: 1000000, mortgageValue: 100000 },

  // ── Top row: Free Parking → Go To Jail ────────────────────────────────────
  { index: 20, type: 'free-parking',  name: 'Free Parking' },
  { index: 21, type: 'property',      name: 'Strand',               price: 220000, colorGroup: 'red',       cardFrame: 14, rents: [180000,900000,2500000,7000000,8750000,10500000], houseCost: 1500000, mortgageValue: 110000 },
  { index: 22, type: 'chance',        name: 'Chance' },
  { index: 23, type: 'property',      name: 'Fleet Street',         price: 220000, colorGroup: 'red',       cardFrame: 15, rents: [180000,900000,2500000,7000000,8750000,10500000], houseCost: 1500000, mortgageValue: 110000 },
  { index: 24, type: 'property',      name: 'Trafalgar Square',     price: 240000, colorGroup: 'red',       cardFrame: 16, rents: [200000,1000000,3000000,7500000,9250000,11000000],houseCost: 1500000, mortgageValue: 120000 },
  { index: 25, type: 'railroad',      name: 'Fenchurch St. Station',price: 200000, colorGroup: 'railroad',  cardFrame: 13, railroadRents: [500000,1000000,1500000,2000000],  mortgageValue: 100000 },
  { index: 26, type: 'property',      name: 'Leicester Square',     price: 260000, colorGroup: 'yellow',    cardFrame: 17, rents: [220000,1100000,3300000,8000000,9750000,11500000], houseCost: 1500000, mortgageValue: 130000 },
  { index: 27, type: 'property',      name: 'Coventry Street',      price: 260000, colorGroup: 'yellow',    cardFrame: 18, rents: [220000,1100000,3300000,8000000,9750000,11500000], houseCost: 1500000, mortgageValue: 130000 },
  { index: 28, type: 'utility',       name: 'Water Works',          price: 150000, colorGroup: 'utility',   cardFrame: 26, utilityMultipliers: [4, 10],      mortgageValue: 75000 },
  { index: 29, type: 'property',      name: 'Piccadilly',           price: 280000, colorGroup: 'yellow',    cardFrame: 19, rents: [240000,1200000,3600000,8500000,10250000,12000000],houseCost: 1500000, mortgageValue: 140000 },

  // ── Right column: Go To Jail → GO ─────────────────────────────────────────
  { index: 30, type: 'go-to-jail',    name: 'Go To Jail' },
  { index: 31, type: 'property',      name: 'Regent Street',        price: 300000, colorGroup: 'green',     cardFrame: 21, rents: [260000,1300000,3900000,9000000,11000000,12750000],houseCost: 2000000, mortgageValue: 150000 },
  { index: 32, type: 'property',      name: 'Oxford Street',        price: 300000, colorGroup: 'green',     cardFrame: 22, rents: [260000,1300000,3900000,9000000,11000000,12750000],houseCost: 2000000, mortgageValue: 150000 },
  { index: 33, type: 'community-chest', name: 'Community Chest' },
  { index: 34, type: 'property',      name: 'Bond Street',          price: 320000, colorGroup: 'green',     cardFrame: 23, rents: [280000,1500000,4500000,10000000,12000000,14000000],houseCost: 2000000, mortgageValue: 160000 },
  { index: 35, type: 'railroad',      name: 'Liverpool St. Station',price: 200000, colorGroup: 'railroad',  cardFrame: 20, railroadRents: [500000,1000000,1500000,2000000],  mortgageValue: 100000 },
  { index: 36, type: 'chance',        name: 'Chance' },
  { index: 37, type: 'property',      name: 'Park Lane',            price: 350000, colorGroup: 'dark-blue', cardFrame: 24, rents: [350000,1750000,5000000,11000000,13000000,15000000],houseCost: 2000000, mortgageValue: 175000 },
  { index: 38, type: 'tax',           name: 'Luxury Tax',           taxAmount: 100000 },
  { index: 39, type: 'property',      name: 'Mayfair',              price: 400000, colorGroup: 'dark-blue', cardFrame: 27, rents: [500000,2000000,6000000,14000000,17000000,20000000],houseCost: 2000000, mortgageValue: 200000 },
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
  { id: 0,  deck: 'community-chest', description: 'Advance to Go — collect £200K.',                                           effect: { type: 'advance-to', value: 0 } },
  { id: 1,  deck: 'community-chest', description: 'Bank error in your favour — collect £200K.',                               effect: { type: 'money', value: 200000 } },
  { id: 2,  deck: 'community-chest', description: "Doctor's fee — pay £50K.",                                                 effect: { type: 'money', value: -50000 } },
  { id: 3,  deck: 'community-chest', description: 'From sale of stock — collect £50K.',                                       effect: { type: 'money', value: 50000 } },
  { id: 4,  deck: 'community-chest', description: 'Get Out of Jail Free.',                                                   effect: { type: 'jail-free' } },
  { id: 5,  deck: 'community-chest', description: 'Go to Jail — go directly to jail.',                                       effect: { type: 'jail' } },
  { id: 6,  deck: 'community-chest', description: 'Holiday fund matures — collect £100K.',                                    effect: { type: 'money', value: 100000 } },
  { id: 7,  deck: 'community-chest', description: 'Income tax refund — collect £20K.',                                        effect: { type: 'money', value: 20000 } },
  { id: 8,  deck: 'community-chest', description: 'It is your birthday — collect £10K from every player.',                   effect: { type: 'money-from-players', value: 10000 } },
  { id: 9,  deck: 'community-chest', description: 'Life insurance matures — collect £100K.',                                  effect: { type: 'money', value: 100000 } },
  { id: 10, deck: 'community-chest', description: 'Pay hospital fees — pay £100K.',                                           effect: { type: 'money', value: -100000 } },
  { id: 11, deck: 'community-chest', description: 'Pay school fees — pay £150K.',                                             effect: { type: 'money', value: -150000 } },
  { id: 12, deck: 'community-chest', description: 'Receive £25K consultancy fee.',                                            effect: { type: 'money', value: 25000 } },
  { id: 13, deck: 'community-chest', description: 'You are assessed for street repairs — pay £40K per house, £115K per hotel.',effect: { type: 'money-per-building', perHouse: 40000, perHotel: 115000 } },
  { id: 14, deck: 'community-chest', description: 'You have won second prize in a beauty contest — collect £10K.',            effect: { type: 'money', value: 10000 } },
  { id: 15, deck: 'community-chest', description: 'You inherit £100K.',                                                       effect: { type: 'money', value: 100000 } },
];

// ─── Chance Cards (16) ────────────────────────────────────────────────────────

export const CHANCE_CARDS: GameCard[] = [
  { id: 0,  deck: 'chance', description: 'Advance to Go — collect £200K.',                                                      effect: { type: 'advance-to', value: 0 } },
  { id: 1,  deck: 'chance', description: 'Advance to Trafalgar Square — if you pass Go collect £200K.',                         effect: { type: 'advance-to', value: 24 } },
  { id: 2,  deck: 'chance', description: 'Advance to Mayfair.',                                                                effect: { type: 'advance-to', value: 39 } },
  { id: 3,  deck: 'chance', description: 'Advance to Pall Mall — if you pass Go collect £200K.',                                effect: { type: 'advance-to', value: 11 } },
  { id: 4,  deck: 'chance', description: 'Advance to nearest utility. If unowned you may buy. If owned pay 10× dice roll.',    effect: { type: 'advance-nearest', targetType: 'utility' } },
  { id: 5,  deck: 'chance', description: 'Advance to nearest railway. If unowned you may buy. If owned pay 2× normal rent.',   effect: { type: 'advance-nearest', targetType: 'railroad' } },
  { id: 6,  deck: 'chance', description: 'Bank pays you a dividend of £50K.',                                                   effect: { type: 'money', value: 50000 } },
  { id: 7,  deck: 'chance', description: 'Get Out of Jail Free.',                                                              effect: { type: 'jail-free' } },
  { id: 8,  deck: 'chance', description: 'Go back 3 spaces.',                                                                  effect: { type: 'move-back', value: 3 } },
  { id: 9,  deck: 'chance', description: 'Go to Jail — go directly to jail.',                                                  effect: { type: 'jail' } },
  { id: 10, deck: 'chance', description: 'Make general repairs on all your properties — pay £25K per house, £100K per hotel.',   effect: { type: 'money-per-building', perHouse: 25000, perHotel: 100000 } },
  { id: 11, deck: 'chance', description: 'Speeding fine — pay £15K.',                                                           effect: { type: 'money', value: -15000 } },
  { id: 12, deck: 'chance', description: 'Take a trip to Kings Cross Station — if you pass Go collect £200K.',                  effect: { type: 'advance-to', value: 5 } },
  { id: 13, deck: 'chance', description: 'You have been elected Chairman of the Board — pay each player £50K.',                 effect: { type: 'money-from-players', value: -50000 } },
  { id: 14, deck: 'chance', description: 'Your building loan matures — collect £150K.',                                         effect: { type: 'money', value: 150000 } },
  { id: 15, deck: 'chance', description: 'You are assessed for street repairs — pay £40K per house, £115K per hotel.',           effect: { type: 'money-per-building', perHouse: 40000, perHotel: 115000 } },
];

// Card lookup maps
export const COMMUNITY_CHEST_MAP = new Map<number, GameCard>(
  COMMUNITY_CHEST_CARDS.map(c => [c.id, c])
);
export const CHANCE_MAP = new Map<number, GameCard>(
  CHANCE_CARDS.map(c => [c.id, c])
);
