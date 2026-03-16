// ─── Game Rules ───────────────────────────────────────────────────────────────

export const RULES = {
  STARTING_MONEY: 15000000,
  GO_SALARY: 2000000,
  JAIL_FINE: 500000,
  JAIL_SPACE_INDEX: 10,
  GO_TO_JAIL_INDEX: 30,
  GO_INDEX: 0,
  FREE_PARKING_INDEX: 20,
  MAX_PLAYERS: 4,
  MAX_HOUSES_PER_PROPERTY: 4,
  MAX_HOUSES_IN_BANK: 32,
  MAX_HOTELS_IN_BANK: 12,
  MAX_JAIL_TURNS: 3,
  MAX_DOUBLES_BEFORE_JAIL: 3,
  ROOM_CODE_LENGTH: 6,
  RECONNECT_WINDOW_SECONDS: 60,
  ROOM_IDLE_TIMEOUT_MS: 60 * 60 * 1000, // 1 hour
  MORTGAGE_INTEREST_RATE: 0.1,           // 10% to unmortgage on top of value

  // Animation delay constants (ms) — server waits this long before sending state-update
  // so the client has time to play the animation triggered by the preceding event
  ANIMATION_DICE_ROLL_MS: 800,
  ANIMATION_TOKEN_MOVE_PER_SPACE_MS: 150,
  ANIMATION_CARD_REVEAL_MS: 2500,
} as const;
