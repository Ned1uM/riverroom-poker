export const PLAYER = 0;
export const DECK = Object.freeze(Array.from({ length: 54 }, (_, card) => card));
export const COMBOS = Object.freeze({
  single: '单牌', pair: '对子', triple: '三张', tripleSingle: '三带一', triplePair: '三带一对',
  straight: '顺子', pairs: '连对', airplane: '飞机', airplaneSingles: '飞机带单',
  airplanePairs: '飞机带对', fourSingles: '四带二', fourPairs: '四带两对', bomb: '炸弹', rocket: '王炸',
});

const nextSeat = seat => (seat + 1) % 3;

export function cardRank(card) {
  if (card >= 52) return card - 36;
  return card % 13 === 0 ? 15 : card % 13 + 2;
}

export function sortCards(cards) {
  return [...cards].sort((left, right) => cardRank(right) - cardRank(left) || left - right);
}

export function groupCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const rank = cardRank(card);
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank).push(card);
  }
  return groups;
}

export function remainingRanks(cards, playedCards = []) {
  const seen = new Set([...cards, ...playedCards]);
  const counts = Array(18).fill(0);
  for (const card of DECK) {
    if (!seen.has(card)) counts[cardRank(card)]++;
  }
  return counts;
}

function isRun(ranks, minimum) {
  return ranks.length >= minimum && ranks.at(-1) <= 14 && ranks.at(-1) - ranks[0] === ranks.length - 1;
}

export function classify(cards) {
  const size = cards.length;
  if (!size || size > 20 || new Set(cards).size !== size ||
      cards.some(card => !Number.isInteger(card) || card < 0 || card >= DECK.length)) return null;
  const groups = groupCards(cards);
  const byCount = [[], [], [], [], []];
  for (const [rank, pile] of groups) byCount[pile.length].push(rank);
  const [, singles, pairs, triples, quads] = byCount;
  const combo = (kind, rank) => ({ kind, rank, size });
  const hasJokers = groups.has(16) && groups.has(17);

  if (groups.size === 1) return combo(['', 'single', 'pair', 'triple', 'bomb'][size], groups.keys().next().value);
  if (size === 2 && hasJokers) return combo('rocket', 17);
  if (quads.length === 1) {
    if (size === 6 && !hasJokers) return combo('fourSingles', quads[0]);
    if (size === 8 && pairs.length === 2) return combo('fourPairs', quads[0]);
  }
  if (quads.length) return null;

  if (triples.length === 1) {
    if (size === 4) return combo('tripleSingle', triples[0]);
    if (size === 5 && pairs.length === 1) return combo('triplePair', triples[0]);
  }
  triples.sort((a, b) => a - b);
  if (isRun(triples, 2)) {
    const length = triples.length;
    const high = triples.at(-1);
    if (size === 3 * length) return combo('airplane', high);
    if (size === 4 * length && !hasJokers) return combo('airplaneSingles', high);
    if (size === 5 * length && pairs.length === length) return combo('airplanePairs', high);
  }

  singles.sort((a, b) => a - b);
  if (size === singles.length && isRun(singles, 5)) return combo('straight', singles.at(-1));
  pairs.sort((a, b) => a - b);
  if (size === pairs.length * 2 && isRun(pairs, 3)) return combo('pairs', pairs.at(-1));
  return null;
}

export function isBomb(combo) {
  return combo.kind === 'bomb' || combo.kind === 'rocket';
}

export function beats(combo, current) {
  if (!combo) return false;
  if (!current) return true;
  if (combo.kind === 'rocket') return current.kind !== 'rocket';
  if (current.kind === 'rocket') return false;
  if (combo.kind === 'bomb' && current.kind !== 'bomb') return true;
  return combo.kind === current.kind && combo.size === current.size && combo.rank > current.rank;
}

export function createMatch(random = Math.random) {
  return { random, scores: [0, 0, 0], round: null };
}

export function startRound(match) {
  const previous = match.round;
  if (previous && previous.phase !== 'ended' && previous.phase !== 'redeal') return false;
  const deck = [...DECK];
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(match.random() * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  const first = previous ? nextSeat(previous.first) : PLAYER;
  const number = previous ? previous.number + Number(previous.phase === 'ended') : 1;
  match.round = {
    number, first, turn: first, phase: 'bidding', bottom: deck.slice(51),
    hands: [0, 1, 2].map(seat => sortCards(deck.slice(seat * 17, (seat + 1) * 17))),
    bid: 0, bidder: null, bids: 0, landlord: null,
    trick: null, passes: 0, multiplier: 1, played: [0, 0, 0], log: [], result: null,
  };
  return true;
}

export function bid(match, seat, points) {
  const { round } = match;
  if (round?.phase !== 'bidding' || round.turn !== seat ||
      !Number.isInteger(points) || points < 0 || points > 3 || (points && points <= round.bid)) return false;
  round.log.push({ kind: 'bid', seat, points });
  if (points > 0) {
    round.bid = points;
    round.bidder = seat;
  }
  round.bids++;
  if (round.bid === 3 || round.bids === 3) {
    if (round.bidder === null) {
      round.phase = 'redeal';
      round.turn = null;
      return true;
    }
    round.landlord = round.bidder;
    round.turn = round.landlord;
    round.hands[round.landlord] = sortCards([...round.hands[round.landlord], ...round.bottom]);
    round.phase = 'playing';
    round.log.push({ kind: 'landlord', seat: round.landlord, points: round.bid });
  } else {
    round.turn = nextSeat(seat);
  }
  return true;
}

function settle(match, winner) {
  const { round } = match;
  const landlordWon = winner === round.landlord;
  let spring = null;
  if (landlordWon && round.played.every((count, seat) => seat === round.landlord || count === 0)) spring = '春天';
  if (!landlordWon && round.played[round.landlord] === 1) spring = '反春';
  if (spring) round.multiplier *= 2;
  const points = round.bid * round.multiplier;
  const changes = match.scores.map((_, seat) => (seat === round.landlord ? 2 : -1) * (landlordWon ? points : -points));
  changes.forEach((change, seat) => { match.scores[seat] += change; });
  round.phase = 'ended';
  round.turn = null;
  round.result = { winner, landlordWon, spring, changes };
}

export function play(match, seat, cards) {
  const { round } = match;
  if (round?.phase !== 'playing' || round.turn !== seat) return false;
  if (!cards.length) {
    if (!round.trick) return false;
    round.log.push({ kind: 'pass', seat });
    if (++round.passes === 2) {
      round.turn = round.trick.seat;
      round.trick = null;
      round.passes = 0;
    } else {
      round.turn = nextSeat(seat);
    }
    return true;
  }

  const combo = classify(cards);
  if (!beats(combo, round.trick?.combo) || !cards.every(card => round.hands[seat].includes(card))) return false;
  const shown = sortCards(cards);
  const removed = new Set(shown);
  round.hands[seat] = round.hands[seat].filter(card => !removed.has(card));
  round.trick = { seat, cards: shown, combo };
  round.passes = 0;
  round.played[seat]++;
  if (isBomb(combo)) round.multiplier *= 2;
  round.log.push({ kind: 'play', ...round.trick });
  if (round.hands[seat].length === 0) settle(match, seat);
  else round.turn = nextSeat(seat);
  return true;
}

export function seatView(round, seat) {
  return {
    seat, landlord: round.landlord, bid: round.bid, trick: round.trick,
    cards: round.hands[seat].slice(),
    counts: round.hands.map(hand => hand.length),
    playedCards: round.log.flatMap(event => event.cards ?? []),
  };
}
