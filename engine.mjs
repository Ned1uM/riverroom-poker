export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const STARTING_STACK = 1000;
export const PLAYER = 0;
export const SEAT_COUNTS = Object.freeze([2, 3, 4, 5]);
export const STREETS = ['翻牌前', '翻牌', '转牌', '河牌'];
export const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export const DECK = Object.freeze(Array.from({ length: 52 }, (_, card) => card));

const SCORE_UNIT = 15 ** 5;
const RANK_UNIT = 15 ** 4;

export const rankOf = card => card % 13 + 2;
export const suitOf = card => Math.floor(card / 13);
export const handCategory = value => Math.floor(value / SCORE_UNIT);
export const handName = value => value === 8 * SCORE_UNIT + 14 * RANK_UNIT
  ? '皇家同花顺'
  : HAND_NAMES[handCategory(value)];

function encode(category, ranks) {
  let value = category;
  for (let i = 0; i < 5; i++) value = value * 15 + (ranks[i] ?? 0);
  return value;
}

function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let high = 14; high >= 5; high--) {
    if (((mask >> (high - 4)) & 31) === 31) return high;
  }
  return 0;
}

function topRanks(mask, limit) {
  const ranks = [];
  for (let rank = 14; rank >= 2 && ranks.length < limit; rank--) {
    if (mask & (1 << rank)) ranks.push(rank);
  }
  return ranks;
}

// Rank the best five cards directly, including the ace-low straight.
export function rankHand(cards) {
  const counts = new Uint8Array(15);
  const suits = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let mask = 0;
  for (const card of cards) {
    const rank = rankOf(card);
    const suit = suitOf(card);
    counts[rank]++;
    suits[suit]++;
    suitMasks[suit] |= 1 << rank;
    mask |= 1 << rank;
  }

  const flushSuit = suits.findIndex(count => count >= 5);
  if (flushSuit !== -1) {
    const high = straightHigh(suitMasks[flushSuit]);
    if (high) return encode(8, [high]);
  }

  let quads = 0;
  const trips = [];
  const pairs = [];
  for (let rank = 14; rank >= 2; rank--) {
    if (counts[rank] === 4) quads = rank;
    if (counts[rank] === 3) trips.push(rank);
    if (counts[rank] === 2) pairs.push(rank);
  }

  if (quads) return encode(7, [quads, ...topRanks(mask & ~(1 << quads), 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    return encode(6, [trips[0], Math.max(trips[1] ?? 0, pairs[0] ?? 0)]);
  }
  if (flushSuit !== -1) return encode(5, topRanks(suitMasks[flushSuit], 5));
  const high = straightHigh(mask);
  if (high) return encode(4, [high]);
  if (trips.length) return encode(3, [trips[0], ...topRanks(mask & ~(1 << trips[0]), 2)]);
  if (pairs.length > 1) {
    const kickers = mask & ~((1 << pairs[0]) | (1 << pairs[1]));
    return encode(2, [pairs[0], pairs[1], ...topRanks(kickers, 1)]);
  }
  if (pairs.length) return encode(1, [pairs[0], ...topRanks(mask & ~(1 << pairs[0]), 3)]);
  return encode(0, topRanks(mask, 5));
}

export function bestFive(pocket, board, score) {
  const cards = [...pocket, ...board];
  // Try the five community cards first in case they make the best hand on their own.
  for (let first = 0; first < cards.length - 1; first++) {
    for (let second = first + 1; second < cards.length; second++) {
      const five = cards.filter((_, index) => index !== first && index !== second);
      if (rankHand(five) === score) return five.sort((left, right) => rankOf(right) - rankOf(left));
    }
  }
  return [];
}

export function createGame(seatCount = 2, random = Math.random) {
  if (!SEAT_COUNTS.includes(seatCount)) throw new RangeError('Unsupported seat count');
  return { stacks: Array(seatCount).fill(STARTING_STACK), hand: null, random };
}

export function matchEnded(game) {
  return game.stacks[PLAYER] === 0 || game.stacks.filter(stack => stack > 0).length < 2;
}

function clockwise(from, seatCount) {
  return Array.from({ length: seatCount }, (_, index) => (from + index + 1) % seatCount);
}

function shuffledDeck(random) {
  const deck = [...DECK];
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

export function potSize(hand) {
  return hand.committed.reduce((total, amount) => total + amount, 0);
}

export function seatRole(hand, seat) {
  if (!hand?.dealOrder.includes(seat)) return null;
  if (seat === hand.dealer) return seat === hand.smallBlind ? 'buttonSmallBlind' : 'button';
  if (seat === hand.smallBlind) return 'smallBlind';
  if (seat === hand.bigBlind) return 'bigBlind';
  return seat === hand.dealOrder.at(-2) ? 'cutoff' : 'hijack';
}

function commit(game, seat, amount) {
  const { hand, stacks } = game;
  stacks[seat] -= amount;
  hand.committed[seat] += amount;
  hand.streetBets[seat] += amount;
}

function postBlind(game, seat, blind, move) {
  const amount = Math.min(blind, game.stacks[seat]);
  commit(game, seat, amount);
  game.hand.log.push({ kind: 'blind', seat, move, amount, street: 0, allIn: game.stacks[seat] === 0 });
}

export function startHand(game, difficulty) {
  if (game.hand && game.hand.phase !== 'ended') return false;
  if (matchEnded(game)) return false;

  const { stacks, hand: previous } = game;
  const seatCount = stacks.length;
  const seated = stacks.map(stack => stack > 0);
  const headsUp = seated.filter(Boolean).length === 2;
  let dealer = clockwise(previous?.dealer ?? -1, seatCount).find(seat => seated[seat]);
  if (headsUp && previous?.dealOrder.length > 2 && seated[previous.bigBlind]) {
    dealer = previous.bigBlind;
  }
  const dealOrder = clockwise(dealer, seatCount).filter(seat => seated[seat]);
  const smallBlind = headsUp ? dealer : dealOrder[0];
  const bigBlind = headsUp ? dealOrder[0] : dealOrder[1];
  const deck = shuffledDeck(game.random);
  const pockets = Array.from({ length: seatCount }, () => []);
  for (let card = 0; card < 2; card++) {
    for (const seat of dealOrder) pockets[seat].push(deck.pop());
  }
  game.hand = {
    number: (previous?.number ?? 0) + 1, dealer, smallBlind, bigBlind,
    dealOrder, difficulty, deck, pockets, inHand: seated,
    phase: 'betting', street: 0, board: [], toAct: null,
    committed: Array(seatCount).fill(0), streetBets: Array(seatCount).fill(0),
    actedAt: Array(seatCount).fill(null), lastFullRaise: BIG_BLIND,
    openingStacks: [...stacks], log: [], result: null,
  };

  postBlind(game, smallBlind, SMALL_BLIND, 'small');
  postBlind(game, bigBlind, BIG_BLIND, 'big');
  continueBetting(game, bigBlind);
  return true;
}

function seatsWithChips(game) {
  return game.hand.dealOrder.filter(seat => game.hand.inHand[seat] && game.stacks[seat] > 0);
}

function streetTarget(hand, fundedCount) {
  const bringIn = hand.street === 0 && fundedCount > 1 ? BIG_BLIND : 0;
  return Math.max(bringIn, ...hand.streetBets);
}

export function actionOptions(game) {
  const { hand, stacks } = game;
  if (hand?.phase !== 'betting' || hand.toAct === null) return null;
  const seat = hand.toAct;
  const fundedCount = seatsWithChips(game).length;
  const currentBet = streetTarget(hand, fundedCount);
  const ownBet = hand.streetBets[seat];
  const toCall = Math.min(stacks[seat], currentBet - ownBet);
  const maxRaiseTo = ownBet + stacks[seat];
  const minRaiseTo = Math.min(maxRaiseTo, currentBet + hand.lastFullRaise);
  const lastAction = hand.actedAt[seat];
  const reopened = lastAction === null || currentBet - lastAction >= hand.lastFullRaise;
  const opposingStacks = hand.dealOrder.filter(other => other !== seat && hand.inHand[other])
    .map(other => hand.streetBets[other] + stacks[other]);
  const covered = hand.committed[seat] + toCall;
  return {
    seat, ownBet, currentBet, toCall, maxRaiseTo, minRaiseTo,
    canRaise: fundedCount > 1 && reopened && maxRaiseTo > currentBet,
    effectiveRaiseTo: Math.min(maxRaiseTo, Math.max(...opposingStacks)),
    contestedPot: hand.committed.reduce((total, amount) => total + Math.min(amount, covered), 0),
  };
}

export function act(game, seat, move, raiseTo) {
  const options = actionOptions(game);
  if (!options || options.seat !== seat) return false;
  const { hand } = game;
  const { ownBet, currentBet, toCall, canRaise, minRaiseTo, maxRaiseTo } = options;
  const event = {
    kind: 'action', seat, move, street: hand.street, potBefore: potSize(hand), amount: 0,
  };

  switch (move) {
    case 'fold':
      hand.inHand[seat] = false;
      break;
    case 'call':
      commit(game, seat, toCall);
      event.move = toCall ? 'call' : 'check';
      event.amount = toCall;
      hand.actedAt[seat] = currentBet;
      break;
    case 'raise': {
      if (!canRaise || !Number.isInteger(raiseTo) || raiseTo < minRaiseTo || raiseTo > maxRaiseTo) return false;
      commit(game, seat, raiseTo - ownBet);
      event.move = currentBet ? 'raise' : 'bet';
      event.amount = raiseTo;
      hand.actedAt[seat] = raiseTo;
      hand.lastFullRaise = Math.max(hand.lastFullRaise, raiseTo - currentBet);
      break;
    }
    default:
      return false;
  }

  event.allIn = game.stacks[seat] === 0;
  hand.log.push(event);
  continueBetting(game, seat);
  return true;
}

function continueBetting(game, previous) {
  const { hand, stacks } = game;
  if (hand.inHand.filter(Boolean).length === 1) {
    refundUncalled(game);
    finishHand(game, 'fold');
    return;
  }

  const funded = seatsWithChips(game);
  const target = streetTarget(hand, funded.length);
  const next = clockwise(previous, stacks.length).find(seat => funded.includes(seat) && (
    hand.streetBets[seat] < target || (funded.length > 1 && hand.actedAt[seat] === null)
  ));
  if (next !== undefined) hand.toAct = next;
  else closeStreet(game);
}

function refundUncalled(game) {
  const { hand, stacks } = game;
  const [largest, second] = [...hand.streetBets].sort((a, b) => b - a);
  const amount = largest - second;
  if (!amount) return;
  const seat = hand.streetBets.indexOf(largest);
  stacks[seat] += amount;
  hand.streetBets[seat] -= amount;
  hand.committed[seat] -= amount;
  hand.log.push({ kind: 'refund', seat, amount, street: hand.street });
}

function closeStreet(game) {
  const { hand } = game;
  refundUncalled(game);
  if (hand.street === 3) {
    finishHand(game, 'showdown');
  } else if (seatsWithChips(game).length < 2) {
    hand.phase = 'runout';
    hand.toAct = null;
  } else {
    revealStreet(hand);
    const funded = seatsWithChips(game);
    hand.toAct = hand.dealOrder.find(seat => funded.includes(seat));
  }
}

function revealStreet(hand) {
  hand.street++;
  hand.deck.pop();
  const count = hand.street === 1 ? 3 : 1;
  for (let index = 0; index < count; index++) hand.board.push(hand.deck.pop());
  hand.streetBets.fill(0);
  hand.actedAt.fill(null);
  hand.lastFullRaise = BIG_BLIND;
  hand.log.push({ kind: 'street', street: hand.street });
}

export function advanceRunout(game) {
  if (game.hand?.phase !== 'runout') return false;
  if (game.hand.street < 3) revealStreet(game.hand);
  else finishHand(game, 'showdown');
  return true;
}

function splitPots(hand, liveSeats, scores) {
  const levels = [...new Set(hand.committed.filter(Boolean))].sort((a, b) => a - b);
  const pots = [];
  let previousLevel = 0;
  for (const level of levels) {
    const contributors = hand.committed.filter(amount => amount >= level).length;
    const eligible = liveSeats.filter(seat => hand.committed[seat] >= level);
    const amount = (level - previousLevel) * contributors;
    const previous = pots.at(-1);
    // Eligibility only shrinks. Combine tiers from folded wagers with the same contenders.
    if (previous && previous.eligible.length === eligible.length) previous.amount += amount;
    else pots.push({ amount, eligible });
    previousLevel = level;
  }
  return pots.map(({ amount, eligible }) => {
    const best = Math.max(...eligible.map(seat => scores[seat]));
    return { amount, winners: eligible.filter(seat => scores[seat] === best) };
  });
}

function finishHand(game, reason) {
  const { hand, stacks } = game;
  const liveSeats = hand.dealOrder.filter(seat => hand.inHand[seat]);
  const scores = hand.pockets.map((pocket, seat) => reason === 'showdown' && hand.inHand[seat]
    ? rankHand([...pocket, ...hand.board]) : null);
  const pot = potSize(hand);
  const pots = reason === 'fold' ? [{ amount: pot, winners: liveSeats }] : splitPots(hand, liveSeats, scores);
  const payouts = stacks.map(() => 0);
  for (const { amount, winners } of pots) {
    const share = Math.floor(amount / winners.length);
    const odd = amount % winners.length;
    winners.forEach((seat, index) => { payouts[seat] += share + Number(index < odd); });
  }
  payouts.forEach((amount, seat) => { stacks[seat] += amount; });
  hand.result = { reason, scores, pot, pots, payouts, net: stacks[PLAYER] - hand.openingStacks[PLAYER] };
  hand.phase = 'ended';
  hand.toAct = null;
  if (reason === 'showdown') {
    for (const seat of liveSeats) hand.log.push({ kind: 'rank', seat, score: scores[seat], street: hand.street });
  }
  pots.forEach(({ amount, winners }, index) => {
    hand.log.push({ kind: 'result', amount, winners, index, potCount: pots.length, street: hand.street });
  });
}

// Decisions use only this seat's cards and the public information at the table.
function visibleTable(hand, seat) {
  const actions = hand.log.filter(event => event.kind === 'action' && event.seat !== seat);
  return {
    pocket: hand.pockets[seat].slice(),
    board: hand.board.slice(),
    street: hand.street,
    onButton: hand.dealer === seat,
    lastAction: actions.at(-1),
    opponents: hand.dealOrder.filter(other => other !== seat && hand.inHand[other])
      .map(other => ({ seat: other, actions: actions.filter(event => event.seat === other) })),
  };
}

export function opponentView(game) {
  const { hand } = game;
  if (hand?.phase !== 'betting' || hand.toAct === PLAYER || hand.toAct === null) return null;
  return {
    difficulty: hand.difficulty,
    ...visibleTable(hand, hand.toAct),
    ...actionOptions(game),
  };
}

function callPots(hand, stacks, opponents, toCall) {
  const covered = hand.committed[PLAYER] + toCall;
  const limits = opponents.map(({ seat }) => Math.min(covered, hand.committed[seat] + stacks[seat]));
  if (limits.every(limit => limit === covered)) return null;

  const contributions = hand.committed.map((amount, seat) => seat === PLAYER ? covered : Math.min(covered, amount));
  const levels = [...new Set([...contributions, ...limits].filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  return levels.map(level => {
    const amount = (level - previous) * contributions.filter(contribution => contribution >= level).length;
    previous = level;
    return { amount, eligible: limits.flatMap((limit, index) => limit >= level ? [index] : []) };
  });
}

export function playerView(game) {
  const { hand, stacks } = game;
  if (!hand || hand.phase === 'ended' || !hand.inHand[PLAYER]) return null;
  const view = visibleTable(hand, PLAYER);
  const options = hand.toAct === PLAYER ? actionOptions(game) : null;
  const funded = seatsWithChips(game);
  return {
    ...view,
    options,
    role: seatRole(hand, PLAYER),
    stack: stacks[PLAYER],
    pot: potSize(hand),
    actsLastPostflop: funded.at(-1) === PLAYER,
    futureBetting: hand.street < 3 && funded.length > 1 && stacks[PLAYER] > (options?.toCall ?? 0),
    pots: options?.toCall ? callPots(hand, stacks, view.opponents, options.toCall) : null,
  };
}
