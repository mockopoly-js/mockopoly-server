/**
 * DEBT SETTLEMENT — the exit from `turn.mustPayRent`.
 *
 * Covers the two holes that the 3D client's <BankruptcyPanel> exposed:
 *
 *   1. A player who raised enough cash had NO WAY to hand it over.
 *      `setPendingRent` was only ever called, never cleared by a payment, so
 *      `canEndTurn` refused forever and the only exits were bankruptcy or an
 *      exemption the player no longer needed.
 *
 *   2. `BANKRUPTCY_TRANSFER_ASSETS` was declared in the shared contract and had
 *      no `socket.on` anywhere. Despite the name it is not a bankruptcy — it is
 *      the settlement action, and it is the fix for (1).
 *
 * Board figures are read off BOARD_SPACES at runtime rather than hardcoded, so
 * these tests do not break when the board data is retuned.
 *
 * Runner: node's built-in `node:test`. No test framework was added — see the
 * `test` script in package.json.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';

import { gameManager } from './GameManager';
import { GameEngine } from './GameEngine';
import type { GameRoom } from './GameRoom';
import { registerGameHandlers } from '../socket/gameHandlers';
import { registerDealHandlers } from '../socket/dealHandlers';
import { EVENTS } from '../types/SocketEvents';
import { BOARD_SPACES, COLOR_GROUPS } from '../constants/board';
import type { PartnershipProposal, TokenType } from '../types/GameState';

// ─── Harness ─────────────────────────────────────────────────────────────────

interface Captured { event: string; payload: any }

/** A room with `n` started players, plus the plumbing to drive real handlers. */
function makeGame(n: number) {
  const room = gameManager.createRoom('sock-0', 'P0', 'red');
  const tokens: TokenType[] = ['red', 'blue', 'green', 'yellow'];
  for (let i = 1; i < n; i++) {
    room.addPlayer(uuid(), `sock-${i}`, `P${i}`, tokens[i], uuid(), false);
  }
  room.startGame();

  const broadcast: Captured[] = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: any) => { broadcast.push({ event, payload }); },
    }),
  } as unknown as Server;

  /** Register every handler this suite drives, for one player's socket. */
  const connect = (playerIndex: number) => {
    const handlers = new Map<string, (data?: any) => void>();
    const errors: Captured[] = [];
    const socket = {
      on: (event: string, fn: (data?: any) => void) => { handlers.set(event, fn); },
      emit: (event: string, payload: any) => { errors.push({ event, payload }); },
      roomCode: room.state.roomCode,
      playerId: room.state.players[playerIndex].id,
    } as unknown as Socket;

    registerGameHandlers(io, socket);
    registerDealHandlers(io, socket);

    return {
      handlers,
      errors,
      /** Fire a client→server event. Throws if the server never registered it. */
      fire(event: string, data?: any) {
        const fn = handlers.get(event);
        assert.ok(fn, `no server handler registered for "${event}"`);
        fn(data);
      },
    };
  };

  return { room, io, broadcast, connect, players: room.state.players };
}

const space = (index: number) => BOARD_SPACES.find(s => s.index === index)!;

/** Give `playerId` the deed at `spaceIndex` outright. */
function grant(room: GameRoom, playerId: string, spaceIndex: number): void {
  const prop = room.getPropertyState(spaceIndex)!;
  const previous = prop.ownerId ? room.getPlayer(prop.ownerId) : undefined;
  if (previous) previous.properties = previous.properties.filter(i => i !== spaceIndex);
  prop.ownerId = playerId;
  room.getPlayer(playerId)!.properties.push(spaceIndex);
}

/**
 * Put the room in the exact state `handleLanding` produces when the lander
 * cannot afford the rent: position set, phase 'action', pending rent recorded.
 */
function landInDebt(
  room: GameRoom, debtorId: string, spaceIndex: number, rent: number,
  ownerId: string, partnershipId: string | null = null,
): void {
  room.getPlayer(debtorId)!.position = spaceIndex;
  room.state.turn.currentPlayerId = debtorId;
  room.state.turn.hasRolled = true;
  room.setPhase('action');
  room.setPendingRent(rent, ownerId, spaceIndex, partnershipId);
}

/** Form a real partnership over a colour group through the public API. */
function formPartnership(
  room: GameRoom, colorGroup: 'brown' | 'dark-blue',
  equity: { playerId: string; percentage: number }[],
): string {
  const proposal: PartnershipProposal = {
    proposalId: uuid(),
    initiatorId: equity[0].playerId,
    colorGroup,
    proposedEquity: equity,
    acceptedPlayerIds: [],
    status: 'pending',
  };
  room.createPartnershipProposal(proposal);
  for (const eq of equity) room.acceptPartnershipProposal(eq.playerId);
  const formed = room.getPartnershipForGroup(colorGroup);
  assert.ok(formed, 'partnership should have formed');
  return formed.partnershipId;
}

const rentEvents = (c: Captured[]) =>
  c.filter(e => e.event === EVENTS.PROPERTY_RENT_COLLECTED || e.event === EVENTS.PARTNERSHIP_RENT_SPLIT);

// ─── HOLE 1 — the debt had no exit ───────────────────────────────────────────

describe('Hole 1 — settling a rent the player can now afford', () => {
  let g: ReturnType<typeof makeGame>;
  const MAYFAIR = 39;

  beforeEach(() => { g = makeGame(2); });

  test('THE BUG: an affordable debt still blocks end-of-turn until it is settled', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 100_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 500_000, owner.id);

    // The player raises the money (as selling/mortgaging would).
    debtor.money = 900_000;

    // Before the fix there was no way out of this: solvent, but stuck.
    assert.equal(
      GameEngine.canEndTurn(g.room, debtor.id),
      'You must resolve your debt before ending your turn.',
    );

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [], money: 500_000,
    });

    assert.equal(g.room.state.turn.mustPayRent, false);
    assert.equal(g.room.state.turn.rentAmount, null);
    assert.equal(g.room.state.turn.rentOwnerId, null);
    assert.equal(GameEngine.canEndTurn(g.room, debtor.id), null, 'turn should now be endable');
  });

  test('moves exactly the rent, from debtor to owner', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 2_000_000;
    owner.money = 5_000_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });

    assert.equal(debtor.money, 800_000);
    assert.equal(owner.money, 6_200_000);
  });

  test('emits PROPERTY_RENT_COLLECTED, the same event the immediate path emits', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 2_000_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });

    const rent = rentEvents(g.broadcast);
    assert.equal(rent.length, 1);
    assert.equal(rent[0].event, EVENTS.PROPERTY_RENT_COLLECTED);
    assert.deepEqual(rent[0].payload, {
      fromId: debtor.id, toId: owner.id, amount: 1_200_000, spaceIndex: MAYFAIR,
    });
    assert.ok(
      g.broadcast.some(e => e.event === EVENTS.GAME_STATE_UPDATE),
      'state must be broadcast after settling',
    );
  });

  test('refuses while the player still cannot afford it, and mutates nothing', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 400_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    const c = g.connect(0);
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });

    assert.equal(c.errors.length, 1);
    assert.equal(c.errors[0].event, EVENTS.ERROR);
    assert.match(c.errors[0].payload.message, /cannot cover/i);
    assert.equal(debtor.money, 400_000, 'no money may move on a rejected settlement');
    assert.equal(g.room.state.turn.mustPayRent, true, 'the debt must survive a rejection');
  });

  test('refuses a player who is not the current player', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 2_000_000;
    owner.money = 9_000_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    const c = g.connect(1); // the creditor, trying to settle on the debtor's behalf
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });

    assert.match(c.errors[0].payload.message, /not your turn/i);
    assert.equal(g.room.state.turn.mustPayRent, true);
    assert.equal(owner.money, 9_000_000);
  });

  test('refuses when there is no pending rent at all', () => {
    const c = g.connect(0);
    g.room.state.turn.currentPlayerId = g.players[0].id;
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: null, properties: [], money: 0 });
    assert.match(c.errors[0].payload.message, /no outstanding debt/i);
  });

  test('refuses while a rent deal is still being negotiated', () => {
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 5_000_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);
    g.room.createRentDeal({
      dealId: uuid(), debtorId: debtor.id, creditorIds: [owner.id], spaceIndex: MAYFAIR,
      totalRentOwed: 1_200_000, offeredProperties: [], offeredMoney: 0,
      requestedExemption: 600_000, lastOfferBy: debtor.id, acceptedPlayerIds: [], status: 'pending',
    });

    const c = g.connect(0);
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });
    assert.match(c.errors[0].payload.message, /rent deal/i);
  });
});

// ─── The partnership split ───────────────────────────────────────────────────

describe('partnership rent survives the round trip through mustPayRent', () => {
  const BROWN = COLOR_GROUPS['brown'];

  test('THE BUG: splits by equity instead of handing partners[0] the lot', () => {
    const g = makeGame(3);
    const [debtor, minority, majority] = g.players;

    // partners[0] is deliberately the MINORITY holder. `setPendingRent` stores
    // partners[0].playerId as rentOwnerId, so a settlement that trusted that id
    // would hand 100% of the rent to the 30% partner.
    grant(g.room, minority.id, BROWN[0]);
    grant(g.room, majority.id, BROWN[1]);
    const partnershipId = formPartnership(g.room, 'brown', [
      { playerId: minority.id, percentage: 30 },
      { playerId: majority.id, percentage: 70 },
    ]);

    debtor.money = 5_000_000;
    minority.money = 0;
    majority.money = 0;
    landInDebt(g.room, debtor.id, BROWN[0], 1_000_000, minority.id, partnershipId);
    assert.equal(g.room.state.turn.rentOwnerId, minority.id, 'precondition: rentOwnerId is partners[0]');

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: minority.id, properties: [], money: 1_000_000,
    });

    assert.equal(debtor.money, 4_000_000);
    assert.equal(minority.money, 300_000, 'the 30% partner gets 30%, not 100%');
    assert.equal(majority.money, 700_000, 'the 70% partner must not be skipped');
    assert.equal(minority.money + majority.money, 1_000_000, 'the split must be exact');
  });

  test('emits PARTNERSHIP_RENT_SPLIT, not PROPERTY_RENT_COLLECTED', () => {
    const g = makeGame(3);
    const [debtor, a, b] = g.players;
    grant(g.room, a.id, BROWN[0]);
    grant(g.room, b.id, BROWN[1]);
    const pid = formPartnership(g.room, 'brown', [
      { playerId: a.id, percentage: 40 }, { playerId: b.id, percentage: 60 },
    ]);
    debtor.money = 5_000_000;
    landInDebt(g.room, debtor.id, BROWN[0], 1_000_000, a.id, pid);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: a.id, properties: [], money: 1_000_000 });

    const rent = rentEvents(g.broadcast);
    assert.equal(rent.length, 1);
    assert.equal(rent[0].event, EVENTS.PARTNERSHIP_RENT_SPLIT);
    assert.equal(rent[0].payload.fromId, debtor.id);
    assert.equal(rent[0].payload.spaceIndex, BROWN[0]);
    assert.equal(
      rent[0].payload.splits.reduce((n: number, s: any) => n + s.amount, 0),
      1_000_000,
    );
  });

  test('falls back to the deed owner if the partnership dissolved while in debt', () => {
    const g = makeGame(3);
    const [debtor, a, b] = g.players;
    grant(g.room, a.id, BROWN[0]);
    grant(g.room, b.id, BROWN[1]);
    const pid = formPartnership(g.room, 'brown', [
      { playerId: a.id, percentage: 50 }, { playerId: b.id, percentage: 50 },
    ]);
    debtor.money = 5_000_000;
    a.money = 0;
    b.money = 0;
    landInDebt(g.room, debtor.id, BROWN[0], 1_000_000, a.id, pid);

    g.room.dissolvePartnership(g.room.getPartnershipById(pid)!);
    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: a.id, properties: [], money: 1_000_000 });

    // BROWN[0] is A's deed, so A is the creditor once the partnership is gone.
    assert.equal(a.money, 1_000_000);
    assert.equal(b.money, 0);
    assert.equal(g.room.state.turn.mustPayRent, false);
  });
});

// ─── Deeds handed over in lieu of cash ───────────────────────────────────────

describe('deeds in lieu of cash', () => {
  const MAYFAIR = 39;
  const OLD_KENT = 1;

  test('credits a deed at list price and only charges the remainder in cash', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, OLD_KENT);
    const deedValue = space(OLD_KENT).price!;
    const rent = deedValue + 400_000;

    debtor.money = 500_000;
    owner.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, rent, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [OLD_KENT], money: 400_000,
    });

    assert.equal(debtor.money, 100_000, 'only the cash leg comes out of pocket');
    assert.equal(owner.money, 400_000);
    assert.equal(g.room.getPropertyState(OLD_KENT)!.ownerId, owner.id, 'deed must change hands');
    assert.ok(owner.properties.includes(OLD_KENT));
    assert.ok(!debtor.properties.includes(OLD_KENT));
    assert.equal(g.room.state.turn.mustPayRent, false);
  });

  test('a mortgaged deed is credited at mortgage value, not list price', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, OLD_KENT);
    g.room.getPropertyState(OLD_KENT)!.isMortgaged = true;

    const mortgageValue = space(OLD_KENT).mortgageValue!;
    assert.notEqual(mortgageValue, space(OLD_KENT).price!, 'test is meaningless if these match');

    const rent = space(OLD_KENT).price!; // more than the mortgage value
    debtor.money = rent; // enough cash to cover whatever the server decides
    owner.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, rent, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [OLD_KENT], money: 0,
    });

    assert.equal(owner.money, rent - mortgageValue, 'cash leg must use the mortgage value');
    assert.equal(debtor.money, mortgageValue);
  });

  test('a deed that covers the whole debt moves no cash and emits no rent event', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, OLD_KENT);

    debtor.money = 0;
    owner.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, space(OLD_KENT).price!, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [OLD_KENT], money: 0,
    });

    assert.equal(debtor.money, 0);
    assert.equal(owner.money, 0);
    assert.equal(rentEvents(g.broadcast).length, 0, 'a "you paid £0" toast would be a lie');
    assert.equal(g.room.getPropertyState(OLD_KENT)!.ownerId, owner.id);
    assert.equal(g.room.state.turn.mustPayRent, false);
  });

  test('over-paying with deeds does not generate change', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, 3);
    grant(g.room, debtor.id, MAYFAIR);

    debtor.money = 0;
    owner.money = 0;
    landInDebt(g.room, debtor.id, 3, 100_000, owner.id); // deed is worth far more

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [MAYFAIR], money: 0,
    });

    assert.equal(debtor.money, 0, 'no refund for over-paying');
    assert.equal(owner.money, 0);
    assert.equal(g.room.state.turn.mustPayRent, false);
  });
});

// ─── Never trust the client ──────────────────────────────────────────────────

describe('server authority', () => {
  const MAYFAIR = 39;
  const OLD_KENT = 1;

  test('ignores a client-supplied `money` that understates the debt', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 3_000_000;
    owner.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    // A tampered client claiming the rent is £1.
    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1 });

    assert.equal(owner.money, 1_200_000, 'the server charges its own number');
    assert.equal(debtor.money, 1_800_000);
  });

  test('ignores a client-supplied `toPlayerId` and pays the real creditor', () => {
    const g = makeGame(3);
    const [debtor, owner, bystander] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 3_000_000;
    owner.money = 0;
    bystander.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: bystander.id, properties: [], money: 1_200_000,
    });

    assert.equal(owner.money, 1_200_000);
    assert.equal(bystander.money, 0, 'rent must not be redirected by the client');
  });

  test('rejects a deed the player does not own', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, owner.id, OLD_KENT);
    debtor.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, 500_000, owner.id);

    const c = g.connect(0);
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [OLD_KENT], money: 0 });

    assert.match(c.errors[0].payload.message, /do not own/i);
    assert.equal(g.room.getPropertyState(OLD_KENT)!.ownerId, owner.id);
    assert.equal(g.room.state.turn.mustPayRent, true);
  });

  test('rejects a duplicated deed that would otherwise be credited twice', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, OLD_KENT);
    debtor.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, space(OLD_KENT).price! * 2, owner.id);

    const c = g.connect(0);
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id, properties: [OLD_KENT, OLD_KENT], money: 0,
    });

    assert.match(c.errors[0].payload.message, /more than once/i);
    assert.equal(g.room.state.turn.mustPayRent, true);
  });

  test('rejects a deed that still has buildings on it', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, OLD_KENT);
    g.room.getPropertyState(OLD_KENT)!.houses = 2;
    debtor.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, 500_000, owner.id);

    const c = g.connect(0);
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [OLD_KENT], money: 0 });

    assert.match(c.errors[0].payload.message, /buildings/i);
    assert.equal(g.room.getPropertyState(OLD_KENT)!.ownerId, debtor.id);
  });

  test('survives a malformed payload without throwing', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, MAYFAIR);
    debtor.money = 3_000_000;
    landInDebt(g.room, debtor.id, MAYFAIR, 1_200_000, owner.id);

    const c = g.connect(0);
    assert.doesNotThrow(() => { c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, undefined); });
    assert.doesNotThrow(() => { c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { properties: 'nope' }); });
    // Both degrade to "no deeds offered", which the player can afford outright.
    assert.equal(g.room.state.turn.mustPayRent, false);
  });
});

// ─── HOLE 2 — the handler did not exist ──────────────────────────────────────

describe('Hole 2 — BANKRUPTCY_TRANSFER_ASSETS is wired up', () => {
  test('THE BUG: the event is registered at all', () => {
    const g = makeGame(2);
    const { handlers } = g.connect(0);
    assert.ok(
      handlers.has(EVENTS.BANKRUPTCY_TRANSFER_ASSETS),
      'bankruptcy:transfer-assets had no socket.on anywhere in src/',
    );
  });

  test('the client\'s full liquidation sequence settles the debt end to end', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    const MAYFAIR = 39;
    const PARK_LANE = 37;
    const OLD_KENT = 1;
    const WHITECHAPEL = 3;

    grant(g.room, owner.id, MAYFAIR);
    grant(g.room, debtor.id, PARK_LANE);
    grant(g.room, debtor.id, OLD_KENT);
    grant(g.room, debtor.id, WHITECHAPEL);

    // A hotel on Park Lane, which must come down before anything else.
    g.room.getPropertyState(PARK_LANE)!.hasHotel = true;

    const houseCost = space(PARK_LANE).houseCost!;
    const oldKentMortgage = space(OLD_KENT).mortgageValue!;
    const whitechapelPrice = space(WHITECHAPEL).price!;

    // Priced so that no single step covers it: hotel + 4 houses + one mortgage
    // + one deed are all required.
    const rent = houseCost * 5 + oldKentMortgage + whitechapelPrice;
    debtor.money = 0;
    owner.money = 0;
    landInDebt(g.room, debtor.id, MAYFAIR, rent, owner.id);

    assert.equal(
      GameEngine.canEndTurn(g.room, debtor.id),
      'You must resolve your debt before ending your turn.',
    );

    const c = g.connect(0);
    // Exactly the order BankruptcyPanel.commitLiquidation emits in.
    c.fire(EVENTS.BUILD_SELL_HOTEL, { spaceIndex: PARK_LANE });
    for (let i = 0; i < 4; i++) c.fire(EVENTS.BUILD_SELL_HOUSE, { spaceIndex: PARK_LANE });
    c.fire(EVENTS.MORTGAGE_APPLY, { spaceIndex: OLD_KENT });
    c.fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, {
      toPlayerId: owner.id,
      properties: [WHITECHAPEL],
      money: rent - whitechapelPrice,
    });

    assert.deepEqual(c.errors, [], 'no step of the client sequence may be rejected');
    assert.equal(debtor.money, 0, 'everything raised goes to the creditor');
    assert.equal(owner.money, rent - whitechapelPrice);
    assert.equal(g.room.getPropertyState(WHITECHAPEL)!.ownerId, owner.id);
    assert.equal(g.room.getPropertyState(OLD_KENT)!.isMortgaged, true);
    assert.equal(g.room.getPropertyState(PARK_LANE)!.hasHotel, false);
    assert.equal(g.room.getPropertyState(PARK_LANE)!.houses, 0);
    assert.equal(g.room.state.turn.mustPayRent, false);
    assert.equal(GameEngine.canEndTurn(g.room, debtor.id), null);
  });

  test('does not bankrupt anyone — the debtor stays in the game', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, 39);
    debtor.money = 2_000_000;
    landInDebt(g.room, debtor.id, 39, 1_200_000, owner.id);

    g.connect(0).fire(EVENTS.BANKRUPTCY_TRANSFER_ASSETS, { toPlayerId: owner.id, properties: [], money: 1_200_000 });

    assert.equal(debtor.isBankrupt, false);
    assert.equal(g.room.state.status, 'in-progress');
    assert.equal(g.room.state.winnerId, null);
    assert.ok(
      !g.broadcast.some(e => e.event === EVENTS.PLAYER_BANKRUPT),
      'settling is not a bankruptcy',
    );
  });
});

// ─── Regression on the pre-existing auto-settle ──────────────────────────────

describe('GO deduction auto-settle (dealHandlers)', () => {
  const BROWN = COLOR_GROUPS['brown'];

  test('now splits partnership rent instead of paying partners[0] in full', () => {
    const g = makeGame(3);
    const [debtor, minority, majority] = g.players;
    grant(g.room, minority.id, BROWN[0]);
    grant(g.room, majority.id, BROWN[1]);
    const pid = formPartnership(g.room, 'brown', [
      { playerId: minority.id, percentage: 25 },
      { playerId: majority.id, percentage: 75 },
    ]);

    debtor.money = 0;
    minority.money = 0;
    majority.money = 0;
    landInDebt(g.room, debtor.id, BROWN[0], 2_000_000, minority.id, pid);

    // One GO deduction is £2M, exactly covering the rent.
    g.connect(0).fire(EVENTS.LOAN_GO_DEDUCTION, { count: 1 });

    assert.equal(g.room.state.turn.mustPayRent, false);
    assert.equal(minority.money, 500_000);
    assert.equal(majority.money, 1_500_000);
    assert.equal(debtor.money, 0);
    assert.equal(
      rentEvents(g.broadcast).filter(e => e.event === EVENTS.PARTNERSHIP_RENT_SPLIT).length, 1,
      'the auto-collect used to move money silently',
    );
  });

  test('leaves the debt in place when the deduction is not enough', () => {
    const g = makeGame(2);
    const [debtor, owner] = g.players;
    grant(g.room, owner.id, 39);
    debtor.money = 0;
    owner.money = 0;
    landInDebt(g.room, debtor.id, 39, 5_000_000, owner.id);

    g.connect(0).fire(EVENTS.LOAN_GO_DEDUCTION, { count: 1 }); // only £2M

    assert.equal(g.room.state.turn.mustPayRent, true);
    assert.equal(debtor.money, 2_000_000);
    assert.equal(owner.money, 0);
  });
});
