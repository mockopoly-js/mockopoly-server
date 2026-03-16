import type { DrawnCard } from '../types/GameState';
import { COMMUNITY_CHEST_CARDS, CHANCE_CARDS } from '../constants/board';

// ─── Card Deck Manager ──────────────────────────────────────────────────────

export class CardDecks {
  communityChestDeck: number[] = [];
  chanceDeck: number[] = [];
  communityChestDiscard: number[] = [];
  chanceDiscard: number[] = [];

  /** Shuffle both decks fresh */
  shuffle(): void {
    this.communityChestDeck = this.fisherYates(COMMUNITY_CHEST_CARDS.map(c => c.id));
    this.chanceDeck = this.fisherYates(CHANCE_CARDS.map(c => c.id));
    this.communityChestDiscard = [];
    this.chanceDiscard = [];
  }

  /** Draw the top card from a deck. Re-shuffles discard if deck is empty. */
  draw(deck: 'chance' | 'community-chest'): DrawnCard {
    const isCC = deck === 'community-chest';
    let drawPile = isCC ? this.communityChestDeck : this.chanceDeck;
    const discardPile = isCC ? this.communityChestDiscard : this.chanceDiscard;
    const cardDefs = isCC ? COMMUNITY_CHEST_CARDS : CHANCE_CARDS;

    // Re-shuffle discard into draw pile if empty
    if (drawPile.length === 0) {
      const reshuffled = this.fisherYates([...discardPile]);
      if (isCC) {
        this.communityChestDeck = reshuffled;
        this.communityChestDiscard = [];
        drawPile = this.communityChestDeck;
      } else {
        this.chanceDeck = reshuffled;
        this.chanceDiscard = [];
        drawPile = this.chanceDeck;
      }
    }

    const cardId = drawPile.shift()!;

    // Add to discard (unless it's a jail-free card which stays with player)
    const cardDef = cardDefs.find(c => c.id === cardId)!;
    if (cardDef.effect.type !== 'jail-free') {
      if (isCC) this.communityChestDiscard.push(cardId);
      else this.chanceDiscard.push(cardId);
    }

    return {
      deck,
      cardId: cardDef.id,
      description: cardDef.description,
      effect: { ...cardDef.effect },
    };
  }

  /** Fisher-Yates shuffle */
  private fisherYates(arr: number[]): number[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
