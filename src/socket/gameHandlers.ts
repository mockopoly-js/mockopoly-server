import type { Server, Socket } from 'socket.io';
import { EVENTS } from '../types/SocketEvents';
import type {
  C_BuildHouse, C_BuildHotel, C_SellHouse, C_SellHotel,
  C_MortgageApply, C_MortgageLift, C_AuctionBid,
  S_StateUpdate, S_DiceRolled, S_PlayerMoved, S_Landed,
  S_TurnStarted, S_TurnEnded, S_CardDrawn, S_CardEffect,
  S_JailSent, S_JailReleased, S_PropertyBought, S_RentCollected,
  S_AuctionStart, S_AuctionBid as S_AuctionBidPayload, S_AuctionWon,
  S_MortgageApplied, S_MortgageLifteed,
  S_HouseAdded, S_HotelAdded, S_HouseSold, S_HotelSold,
  S_PlayerBankrupt, S_GameOver, S_Error,
  S_FreeParkingCollected, S_PartnershipRentSplit, S_PartnershipBuildCostSplit,
} from '../types/SocketEvents';
import { gameManager } from '../game/GameManager';
import { GameEngine } from '../game/GameEngine';
import { BOARD_SPACES } from '../constants/board';
import { RULES } from '../constants/rules';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContext(socket: Socket) {
  const roomCode = (socket as any).roomCode as string | undefined;
  const playerId = (socket as any).playerId as string | undefined;
  if (!roomCode || !playerId) return null;
  const room = gameManager.getRoom(roomCode);
  if (!room) return null;
  return { roomCode, playerId, room };
}

function emitError(socket: Socket, message: string): void {
  socket.emit(EVENTS.ERROR, { code: 'INVALID_ACTION', message } satisfies S_Error);
}

function broadcastState(io: Server, roomCode: string): void {
  const room = gameManager.getRoom(roomCode);
  if (!room) return;
  io.to(roomCode).emit(EVENTS.GAME_STATE_UPDATE, { state: room.state } satisfies S_StateUpdate);
}

function checkGameOver(io: Server, room: ReturnType<typeof gameManager.getRoom>, roomCode: string): boolean {
  if (!room) return false;
  if (room.state.status === 'game-over' && room.state.winnerId) {
    const winner = room.getPlayer(room.state.winnerId)!;
    io.to(roomCode).emit(EVENTS.GAME_OVER, {
      winnerId: room.state.winnerId,
      finalStandings: room.state.players,
    } satisfies S_GameOver);
    return true;
  }
  return false;
}

// ─── Game Handlers ───────────────────────────────────────────────────────────

export function registerGameHandlers(io: Server, socket: Socket): void {

  // ── Roll Dice ───────────────────────────────────────────────────────────────

  socket.on(EVENTS.TURN_ROLL_DICE, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const player = room.getPlayer(playerId)!;

    // ── Jailed player roll ────────────────────────────────────────────────────
    if (player.isJailed) {
      const err = GameEngine.canJailRoll(room, playerId);
      if (err) return emitError(socket, err);

      const dice = room.rollDice();
      const isDoubles = room.isDoubles();

      io.to(roomCode).emit(EVENTS.TURN_DICE_ROLLED, {
        playerId, dice, isDoubles,
      } satisfies S_DiceRolled);

      setTimeout(() => {
        if (isDoubles) {
          room.releaseFromJail(playerId, 'doubles');
          io.to(roomCode).emit(EVENTS.JAIL_RELEASED, { playerId, method: 'doubles' } satisfies S_JailReleased);

          // Move with the doubles roll
          const move = room.movePlayer(playerId, room.diceTotal());
          io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
            playerId, from: move.from, to: move.to, passedGo: move.passedGo,
          } satisfies S_PlayerMoved);

          setTimeout(() => {
            handleLanding(io, socket, roomCode, playerId, room);
          }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * room.diceTotal());
        } else {
          room.incrementJailTurn(playerId);

          // Forced out after 3 turns
          if (player.jailTurns >= RULES.MAX_JAIL_TURNS) {
            room.releaseFromJail(playerId, 'forced');
            io.to(roomCode).emit(EVENTS.JAIL_RELEASED, { playerId, method: 'forced' } satisfies S_JailReleased);

            const move = room.movePlayer(playerId, room.diceTotal());
            io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
              playerId, from: move.from, to: move.to, passedGo: move.passedGo,
            } satisfies S_PlayerMoved);

            setTimeout(() => {
              handleLanding(io, socket, roomCode, playerId, room);
            }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * room.diceTotal());
          } else {
            room.setPhase('end');
            broadcastState(io, roomCode);
          }
        }
      }, RULES.ANIMATION_DICE_ROLL_MS);

      return;
    }

    // ── Normal roll ───────────────────────────────────────────────────────────
    const err = GameEngine.canRoll(room, playerId);
    if (err) return emitError(socket, err);

    const dice = room.rollDice();
    const isDoubles = room.isDoubles();

    if (isDoubles) {
      room.state.turn.doublesCount++;
    }

    io.to(roomCode).emit(EVENTS.TURN_DICE_ROLLED, {
      playerId, dice, isDoubles,
    } satisfies S_DiceRolled);

    // After dice animation delay, move the player
    setTimeout(() => {
      // Triple doubles → jail
      if (room.state.turn.doublesCount >= RULES.MAX_DOUBLES_BEFORE_JAIL) {
        room.sendToJail(playerId);
        io.to(roomCode).emit(EVENTS.JAIL_SENT, { playerId } satisfies S_JailSent);
        room.setPhase('end');
        broadcastState(io, roomCode);
        return;
      }

      const move = room.movePlayer(playerId, room.diceTotal());

      io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
        playerId, from: move.from, to: move.to, passedGo: move.passedGo,
      } satisfies S_PlayerMoved);

      // After move animation, handle landing
      const spacesToAnimate = move.to >= move.from
        ? move.to - move.from
        : 40 - move.from + move.to;

      setTimeout(() => {
        handleLanding(io, socket, roomCode, playerId, room);
      }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * spacesToAnimate);
    }, RULES.ANIMATION_DICE_ROLL_MS);
  });

  // ── Buy Property ────────────────────────────────────────────────────────────

  socket.on(EVENTS.TURN_BUY_PROPERTY, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canBuyProperty(room, playerId);
    if (err) return emitError(socket, err);

    const player = room.getPlayer(playerId)!;
    const price = room.buyProperty(playerId, player.position);

    io.to(roomCode).emit(EVENTS.PROPERTY_BOUGHT, {
      playerId, spaceIndex: player.position, price,
    } satisfies S_PropertyBought);

    broadcastState(io, roomCode);
  });

  // ── Pass Buy (triggers auction) ─────────────────────────────────────────────

  socket.on(EVENTS.TURN_PASS_BUY, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    if (!GameEngine.isCurrentPlayer(room, playerId)) return;

    const player = room.getPlayer(playerId)!;
    const spaceIndex = player.position;
    const prop = room.getPropertyState(spaceIndex);

    if (!prop || prop.ownerId) return;

    // Start auction among all active players
    const bidderIds = room.activePlayers.map(p => p.id);
    const auction = room.startAuction(spaceIndex, bidderIds);

    io.to(roomCode).emit(EVENTS.PROPERTY_AUCTION_START, {
      spaceIndex,
      startingBid: 1,
      bidderIds,
    } satisfies S_AuctionStart);

    broadcastState(io, roomCode);
  });

  // ── End Turn ────────────────────────────────────────────────────────────────

  socket.on(EVENTS.TURN_END, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canEndTurn(room, playerId);
    if (err) return emitError(socket, err);

    io.to(roomCode).emit(EVENTS.TURN_ENDED, { playerId } satisfies S_TurnEnded);

    // If doubles were rolled and not jailed, roll again
    if (room.isDoubles() && !room.getPlayer(playerId)!.isJailed) {
      room.resetForDoubles();
      broadcastState(io, roomCode);
      return;
    }

    const nextId = room.advanceTurn();
    io.to(roomCode).emit(EVENTS.TURN_STARTED, { playerId: nextId } satisfies S_TurnStarted);
    broadcastState(io, roomCode);
  });

  // ── Jail Actions ────────────────────────────────────────────────────────────

  socket.on(EVENTS.JAIL_PAY_FINE, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canPayJailFine(room, playerId);
    if (err) return emitError(socket, err);

    room.releaseFromJail(playerId, 'fine');
    io.to(roomCode).emit(EVENTS.JAIL_RELEASED, { playerId, method: 'fine' } satisfies S_JailReleased);
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.JAIL_USE_CARD, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canUseJailCard(room, playerId);
    if (err) return emitError(socket, err);

    room.releaseFromJail(playerId, 'card');
    io.to(roomCode).emit(EVENTS.JAIL_RELEASED, { playerId, method: 'card' } satisfies S_JailReleased);
    broadcastState(io, roomCode);
  });

  // ── Building ────────────────────────────────────────────────────────────────

  socket.on(EVENTS.BUILD_BUY_HOUSE, (data: C_BuildHouse) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canBuildHouse(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    const space = BOARD_SPACES.find(s => s.index === data.spaceIndex)!;
    const partnership = space.colorGroup ? room.getPartnershipForGroup(space.colorGroup) : undefined;

    if (partnership) {
      // Partnership building — split costs by equity
      const totalCost = space.houseCost!;
      const splits: { playerId: string; amount: number }[] = [];
      const sorted = [...partnership.partners].sort((a, b) => b.percentage - a.percentage);
      let distributed = 0;

      for (let i = sorted.length - 1; i >= 0; i--) {
        const share = i === 0
          ? totalCost - distributed
          : Math.floor(totalCost * sorted[i].percentage / 100);
        distributed += share;

        const partner = room.getPlayer(sorted[i].playerId);
        if (partner) partner.money -= share;
        splits.push({ playerId: sorted[i].playerId, amount: share });
      }

      const prop = room.getPropertyState(data.spaceIndex)!;
      prop.houses++;
      room.addLog(playerId, 'action', `Partners built a house on ${space.name} (${prop.houses} houses).`);

      io.to(roomCode).emit(EVENTS.PARTNERSHIP_BUILD_COST_SPLIT, {
        spaceIndex: data.spaceIndex, splits,
      } satisfies S_PartnershipBuildCostSplit);
      io.to(roomCode).emit(EVENTS.BUILD_HOUSE_ADDED, {
        playerId, spaceIndex: data.spaceIndex, newCount: prop.houses,
      } satisfies S_HouseAdded);
    } else {
      room.addHouse(playerId, data.spaceIndex);
      const prop = room.getPropertyState(data.spaceIndex)!;

      io.to(roomCode).emit(EVENTS.BUILD_HOUSE_ADDED, {
        playerId, spaceIndex: data.spaceIndex, newCount: prop.houses,
      } satisfies S_HouseAdded);
    }
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.BUILD_BUY_HOTEL, (data: C_BuildHotel) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canBuildHotel(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    const space = BOARD_SPACES.find(s => s.index === data.spaceIndex)!;
    const partnership = space.colorGroup ? room.getPartnershipForGroup(space.colorGroup) : undefined;

    if (partnership) {
      // Partnership hotel — split costs by equity
      const totalCost = space.houseCost!;
      const splits: { playerId: string; amount: number }[] = [];
      const sorted = [...partnership.partners].sort((a, b) => b.percentage - a.percentage);
      let distributed = 0;

      for (let i = sorted.length - 1; i >= 0; i--) {
        const share = i === 0
          ? totalCost - distributed
          : Math.floor(totalCost * sorted[i].percentage / 100);
        distributed += share;

        const partner = room.getPlayer(sorted[i].playerId);
        if (partner) partner.money -= share;
        splits.push({ playerId: sorted[i].playerId, amount: share });
      }

      const prop = room.getPropertyState(data.spaceIndex)!;
      prop.houses = 0;
      prop.hasHotel = true;
      room.addLog(playerId, 'action', `Partners built a hotel on ${space.name}!`);

      io.to(roomCode).emit(EVENTS.PARTNERSHIP_BUILD_COST_SPLIT, {
        spaceIndex: data.spaceIndex, splits,
      } satisfies S_PartnershipBuildCostSplit);
      io.to(roomCode).emit(EVENTS.BUILD_HOTEL_ADDED, {
        playerId, spaceIndex: data.spaceIndex,
      } satisfies S_HotelAdded);
    } else {
      room.addHotel(playerId, data.spaceIndex);

      io.to(roomCode).emit(EVENTS.BUILD_HOTEL_ADDED, {
        playerId, spaceIndex: data.spaceIndex,
      } satisfies S_HotelAdded);
    }
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.BUILD_SELL_HOUSE, (data: C_SellHouse) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canSellHouse(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    room.sellHouse(playerId, data.spaceIndex);
    const prop = room.getPropertyState(data.spaceIndex)!;

    io.to(roomCode).emit(EVENTS.BUILD_HOUSE_SOLD, {
      playerId, spaceIndex: data.spaceIndex, newCount: prop.houses,
    } satisfies S_HouseSold);
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.BUILD_SELL_HOTEL, (data: C_SellHotel) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canSellHotel(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    room.sellHotel(playerId, data.spaceIndex);

    io.to(roomCode).emit(EVENTS.BUILD_HOTEL_SOLD, {
      playerId, spaceIndex: data.spaceIndex,
    } satisfies S_HotelSold);
    broadcastState(io, roomCode);
  });

  // ── Mortgage ────────────────────────────────────────────────────────────────

  socket.on(EVENTS.MORTGAGE_APPLY, (data: C_MortgageApply) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canMortgage(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    const amount = room.applyMortgage(playerId, data.spaceIndex);

    io.to(roomCode).emit(EVENTS.MORTGAGE_APPLIED, {
      playerId, spaceIndex: data.spaceIndex, amount,
    } satisfies S_MortgageApplied);
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.MORTGAGE_LIFT, (data: C_MortgageLift) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canLiftMortgage(room, playerId, data.spaceIndex);
    if (err) return emitError(socket, err);

    const cost = room.liftMortgage(playerId, data.spaceIndex);

    io.to(roomCode).emit(EVENTS.MORTGAGE_LIFTED, {
      playerId, spaceIndex: data.spaceIndex, cost,
    } satisfies S_MortgageLifteed);
    broadcastState(io, roomCode);
  });

  // ── Auction ─────────────────────────────────────────────────────────────────

  socket.on(EVENTS.AUCTION_BID, (data: C_AuctionBid) => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canBid(room, playerId, data.amount);
    if (err) return emitError(socket, err);

    room.placeBid(playerId, data.amount);

    io.to(roomCode).emit(EVENTS.PROPERTY_AUCTION_BID, {
      playerId, amount: data.amount,
    } satisfies S_AuctionBidPayload);
    broadcastState(io, roomCode);
  });

  socket.on(EVENTS.AUCTION_PASS, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const err = GameEngine.canPassAuction(room, playerId);
    if (err) return emitError(socket, err);

    room.removeFromAuction(playerId);

    const auction = room.state.turn.auctionState!;

    // If only one bidder left (or none), complete
    if (auction.activeBidderIds.length <= 1) {
      // If one left and no bids yet, they can win at $1 or it ends with no sale
      if (auction.activeBidderIds.length === 1 && !auction.currentHighBidderId) {
        // Last person standing — they must bid at least 1
        // For simplicity, auto-complete with no winner if no bids
      }

      const result = room.completeAuction();

      io.to(roomCode).emit(EVENTS.PROPERTY_AUCTION_WON, {
        playerId: result.winnerId || '',
        spaceIndex: result.spaceIndex,
        amount: result.amount,
      } satisfies S_AuctionWon);
    }

    broadcastState(io, roomCode);
  });

  // ── Bankruptcy ──────────────────────────────────────────────────────────────

  socket.on(EVENTS.BANKRUPTCY_DECLARE, () => {
    const ctx = getContext(socket);
    if (!ctx) return;
    const { roomCode, playerId, room } = ctx;

    const player = room.getPlayer(playerId)!;
    if (player.isBankrupt) return;

    // Handle partnership dissolution for bankrupt player
    room.handlePartnerBankruptcy(playerId);

    // Determine creditor (whoever they owe rent to, or bank)
    const creditorId = room.state.turn.rentOwnerId;
    room.declareBankruptcy(playerId, creditorId);

    io.to(roomCode).emit(EVENTS.PLAYER_BANKRUPT, {
      playerId, creditorId,
    } satisfies S_PlayerBankrupt);

    if (checkGameOver(io, room, roomCode)) {
      broadcastState(io, roomCode);
      return;
    }

    // If it was their turn, advance
    if (room.state.turn.currentPlayerId === playerId) {
      const nextId = room.advanceTurn();
      io.to(roomCode).emit(EVENTS.TURN_STARTED, { playerId: nextId } satisfies S_TurnStarted);
    }

    broadcastState(io, roomCode);
  });
}

// ─── Landing Logic ───────────────────────────────────────────────────────────

function handleLanding(
  io: Server, socket: Socket,
  roomCode: string, playerId: string,
  room: NonNullable<ReturnType<typeof gameManager.getRoom>>,
): void {
  const player = room.getPlayer(playerId)!;
  const spaceIndex = player.position;
  const space = BOARD_SPACES.find(s => s.index === spaceIndex)!;

  room.setPhase('landing');
  io.to(roomCode).emit(EVENTS.TURN_LANDED, {
    playerId, spaceIndex, spaceType: space.type,
  } satisfies S_Landed);

  switch (space.type) {
    case 'property':
    case 'railroad':
    case 'utility': {
      const prop = room.getPropertyState(spaceIndex)!;

      if (!prop.ownerId) {
        // Unowned — player can buy or auction
        room.setPhase('action');
        broadcastState(io, roomCode);
      } else if (prop.ownerId !== playerId && !prop.isMortgaged) {
        // Check for partnership rent
        const boardSpace = BOARD_SPACES.find(s => s.index === spaceIndex)!;
        const partnership = boardSpace.colorGroup
          ? room.getPartnershipForGroup(boardSpace.colorGroup)
          : undefined;

        if (partnership) {
          // Check if lander is a partner (exempt from rent)
          const isPartner = partnership.partners.some(p => p.playerId === playerId);
          if (isPartner) {
            // Partner lands on own zone — exempt
            room.setPhase('action');
            broadcastState(io, roomCode);
          } else {
            // Non-partner — rent split among partners
            const rent = room.calculateRent(spaceIndex, room.diceTotal());
            if (rent > 0) {
              if (player.money >= rent) {
                // Can afford — collect immediately
                const splits = room.collectPartnershipRent(playerId, spaceIndex, rent, partnership);
                io.to(roomCode).emit(EVENTS.PARTNERSHIP_RENT_SPLIT, {
                  spaceIndex, fromId: playerId, splits,
                } satisfies S_PartnershipRentSplit);
              } else {
                // Can't afford — enter debt resolution (don't deduct yet)
                room.setPendingRent(rent, partnership.partners[0].playerId);
                room.addLog(playerId, 'action', `${player.name} owes £${rent} partnership rent but can't afford it — debt resolution required.`);
              }
            }
            room.setPhase('action');
            broadcastState(io, roomCode);
          }
        } else {
          // Normal rent — single owner
          const rent = room.calculateRent(spaceIndex, room.diceTotal());
          if (rent > 0) {
            if (player.money >= rent) {
              // Can afford — collect immediately
              room.collectRent(playerId, prop.ownerId, rent, spaceIndex);
              io.to(roomCode).emit(EVENTS.PROPERTY_RENT_COLLECTED, {
                fromId: playerId, toId: prop.ownerId,
                amount: rent, spaceIndex,
              } satisfies S_RentCollected);
            } else {
              // Can't afford — enter debt resolution (don't deduct yet)
              room.setPendingRent(rent, prop.ownerId);
              const ownerName = room.getPlayer(prop.ownerId)?.name ?? '?';
              room.addLog(playerId, 'action', `${player.name} owes £${rent} rent to ${ownerName} but can't afford it — debt resolution required.`);
            }
          }
          room.setPhase('action');
          broadcastState(io, roomCode);
        }
      } else {
        // Own property or mortgaged — nothing happens
        room.setPhase('action');
        broadcastState(io, roomCode);
      }
      break;
    }

    case 'community-chest':
    case 'chance': {
      const deck = space.type as 'chance' | 'community-chest';
      const card = room.drawCard(deck);
      room.setPendingCard(card);

      io.to(roomCode).emit(EVENTS.CARD_DRAWN, {
        playerId, deck, card,
      } satisfies S_CardDrawn);

      // Apply card effect after reveal animation
      setTimeout(() => {
        applyCardEffect(io, roomCode, playerId, room);
      }, RULES.ANIMATION_CARD_REVEAL_MS);
      break;
    }

    case 'tax': {
      room.payTax(playerId, space.taxAmount!);
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }

    case 'go-to-jail': {
      room.sendToJail(playerId);
      io.to(roomCode).emit(EVENTS.JAIL_SENT, { playerId } satisfies S_JailSent);
      room.state.turn.doublesCount = 0; // No extra roll after jail
      room.setPhase('end');
      broadcastState(io, roomCode);
      break;
    }

    case 'free-parking': {
      const poolAmount = room.collectFreeParking(playerId);
      if (poolAmount > 0) {
        io.to(roomCode).emit(EVENTS.FREE_PARKING_COLLECTED, {
          playerId, amount: poolAmount,
        } satisfies S_FreeParkingCollected);
      }
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }

    case 'go':
    case 'jail':
    default: {
      // Nothing happens on these spaces
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }
  }
}

// ─── Card Effect Application ─────────────────────────────────────────────────

function applyCardEffect(
  io: Server, roomCode: string, playerId: string,
  room: NonNullable<ReturnType<typeof gameManager.getRoom>>,
): void {
  const card = room.state.turn.pendingCard;
  if (!card) return;

  const player = room.getPlayer(playerId)!;
  const effect = card.effect;

  io.to(roomCode).emit(EVENTS.CARD_EFFECT_APPLIED, {
    playerId, effect,
  } satisfies S_CardEffect);

  switch (effect.type) {
    case 'advance-to': {
      const move = room.movePlayerTo(playerId, effect.value!);
      io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
        playerId, from: move.from, to: move.to, passedGo: move.passedGo,
      } satisfies S_PlayerMoved);

      room.clearPendingCard();

      // Re-evaluate landing on the new space
      const spacesToAnimate = move.to >= move.from
        ? move.to - move.from
        : 40 - move.from + move.to;
      setTimeout(() => {
        handleLanding(io, null as any, roomCode, playerId, room);
      }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * spacesToAnimate);
      break;
    }

    case 'advance-nearest': {
      const target = GameEngine.findNearestOfType(player.position, effect.targetType!);
      const move = room.movePlayerTo(playerId, target);
      io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
        playerId, from: move.from, to: move.to, passedGo: move.passedGo,
      } satisfies S_PlayerMoved);

      room.clearPendingCard();

      const spacesToAnimate = move.to >= move.from
        ? move.to - move.from
        : 40 - move.from + move.to;
      setTimeout(() => {
        handleLanding(io, null as any, roomCode, playerId, room);
      }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * spacesToAnimate);
      break;
    }

    case 'move-back': {
      const move = room.movePlayerBack(playerId, effect.value!);
      io.to(roomCode).emit(EVENTS.TURN_PLAYER_MOVED, {
        playerId, from: move.from, to: move.to, passedGo: false,
      } satisfies S_PlayerMoved);

      room.clearPendingCard();

      setTimeout(() => {
        handleLanding(io, null as any, roomCode, playerId, room);
      }, RULES.ANIMATION_TOKEN_MOVE_PER_SPACE_MS * effect.value!);
      break;
    }

    case 'money': {
      const amount = effect.value!;
      if (amount >= 0) {
        // Card gives money → goes to Free Parking pool instead of player
        room.addToFreeParking(amount);
        room.addLog(playerId, 'card', `${player.name}'s £${amount} went to the Free Parking pool.`);
      } else {
        // Card takes money → deduct from player AND add to pool
        const absAmount = Math.abs(amount);
        room.adjustMoney(playerId, amount, `${player.name} paid £${absAmount}.`);
        room.addToFreeParking(absAmount);
      }
      room.clearPendingCard();
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }

    case 'money-per-building': {
      const cost = room.calculateBuildingCost(playerId, effect.perHouse!, effect.perHotel!);
      room.adjustMoney(playerId, -cost, `${player.name} paid £${cost} for building repairs.`);
      room.addToFreeParking(cost);
      room.clearPendingCard();
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }

    case 'money-from-players': {
      const perPlayer = effect.value!;
      if (perPlayer > 0) {
        const total = room.collectFromAllPlayers(playerId, perPlayer);
        room.addLog(playerId, 'card', `${player.name} collected £${total} from all players.`);
      } else {
        const total = room.payAllPlayers(playerId, Math.abs(perPlayer));
        room.addLog(playerId, 'card', `${player.name} paid £${total} to all players.`);
      }
      room.clearPendingCard();
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }

    case 'jail': {
      room.sendToJail(playerId);
      io.to(roomCode).emit(EVENTS.JAIL_SENT, { playerId } satisfies S_JailSent);
      room.clearPendingCard();
      room.state.turn.doublesCount = 0;
      room.setPhase('end');
      broadcastState(io, roomCode);
      break;
    }

    case 'jail-free': {
      room.giveJailCard(playerId);
      room.clearPendingCard();
      room.setPhase('action');
      broadcastState(io, roomCode);
      break;
    }
  }
}
