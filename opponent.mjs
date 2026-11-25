import { BIG_BLIND, DECK, handCategory, rankHand, rankOf, suitOf } from './engine.mjs';

export const DIFFICULTIES = Object.freeze([
  { id: 'beginner', label: '初学者', description: '偏爱跟注，较少加注和诈唬。',
    samples: 60, error: 0.25, callEdge: -0.09, aggression: 0.26, valueLine: 0.69, bluff: 0.03, reads: 0 },
  { id: 'intermediate', label: '进阶', description: '会看底池赔率，拿到强牌时主动下注。',
    samples: 130, error: 0.13, callEdge: 0.04, aggression: 0.49, valueLine: 0.64, bluff: 0.08, reads: 0 },
  { id: 'advanced', label: '高级', description: '根据桌上的下注估算牌力，尝试用听牌施压。',
    samples: 250, error: 0.06, callEdge: 0.025, aggression: 0.64, valueLine: 0.61, bluff: 0.14, reads: 0.58 },
  { id: 'expert', label: '专家', description: '结合位置和对手行动推测手牌范围，混合价值下注与诈唬。',
    samples: 460, error: 0.034, callEdge: 0.01, aggression: 0.78, valueLine: 0.59, bluff: 0.21, reads: 0.91 },
]);

const clamp = (number, min, max) => Math.max(min, Math.min(max, number));

export function startingStrength([first, second]) {
  const high = Math.max(rankOf(first), rankOf(second));
  const low = Math.min(rankOf(first), rankOf(second));
  if (high === low) return 0.56 + (high - 2) * 0.035;
  const suited = suitOf(first) === suitOf(second) ? 0.07 : 0;
  const connected = high - low <= 2 ? 0.04 : 0;
  return 0.14 + high * 0.028 + low * 0.017 + suited + connected;
}

function rangeRead(boardCards, actions) {
  const bets = actions.filter(action => action.move === 'raise' || action.move === 'bet');
  const preflop = bets.filter(action => action.street === 0).length;
  const later = bets.filter(action => action.street > 0).at(-1);
  if (!later) return { preflop, board: [], boardCategory: -1, weight: 0 };
  const board = boardCards.slice(0, later.street + 2);
  return {
    preflop, board, boardCategory: board.length === 5 ? handCategory(rankHand(board)) : -1,
    weight: clamp(later.amount / Math.max(BIG_BLIND, later.potBefore), 0.35, 1.2),
  };
}

function rangeWeight(pocket, read, accuracy) {
  let weight = 1;
  if (read.preflop) {
    const strength = startingStrength(pocket);
    const cutoff = read.preflop > 1 ? 0.61 : 0.46;
    weight *= clamp(0.63 + (strength - cutoff) * 2.6, 0.16, 1);
  }
  if (read.weight) {
    const made = handCategory(rankHand([...pocket, ...read.board]));
    let streetWeight = [0.38, 0.66, 0.87, 0.98, 1, 1, 1, 1, 1][made];
    if (made <= read.boardCategory) streetWeight = Math.min(streetWeight, 0.56);
    weight *= 1 - (1 - streetWeight) * Math.min(1, read.weight);
  }
  return 1 - (1 - weight) * accuracy;
}

function showdownShare(mine, scores, eligible) {
  let tied = 1;
  for (const index of eligible) {
    if (scores[index] > mine) return 0;
    if (scores[index] === mine) tied++;
  }
  return 1 / tied;
}

export function sampleEquity(view, profile, random = Math.random) {
  const known = new Set([...view.pocket, ...view.board]);
  const pool = DECK.filter(card => !known.has(card));
  const pocketCards = 2 * view.opponents.length;
  const drawCount = pocketCards + 5 - view.board.length;
  const reads = profile.reads ? view.opponents.map(other => rangeRead(view.board, other.actions)) : null;
  const fixedScore = view.board.length === 5 ? rankHand([...view.pocket, ...view.board]) : null;
  const scores = Array(view.opponents.length);
  const allOpponents = view.opponents.map((_, index) => index);
  const contested = view.pots?.reduce((total, pot) => total + pot.amount, 0);
  let total = 0;
  let votes = 0;
  for (let sample = 0; sample < profile.samples; sample++) {
    for (let index = 0; index < drawCount; index++) {
      const swap = index + Math.floor(random() * (pool.length - index));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    const board = [...view.board, ...pool.slice(pocketCards, drawCount)];
    const mine = fixedScore ?? rankHand([...view.pocket, ...board]);
    let weight = 1;
    for (let other = 0; other < view.opponents.length; other++) {
      const pocket = pool.slice(other * 2, other * 2 + 2);
      if (reads) weight *= rangeWeight(pocket, reads[other], profile.reads);
      scores[other] = rankHand([...pocket, ...board]);
    }
    const share = contested
      ? view.pots.reduce((sum, { amount, eligible }) => sum + amount * showdownShare(mine, scores, eligible), 0) / contested
      : showdownShare(mine, scores, allOpponents);
    total += weight;
    votes += weight * share;
  }
  return votes / total;
}

function raiseAmount(view, profile, equity, random) {
  const { contestedPot, toCall, currentBet, minRaiseTo, effectiveRaiseTo } = view;
  let target;
  if (view.street === 0 && currentBet === BIG_BLIND) {
    target = BIG_BLIND * (2 + random() * (profile.reads ? 0.9 : 1.4));
  } else {
    const size = profile.reads ? 0.46 + random() * 0.39 + (equity > 0.8 ? 0.12 : 0) : 0.5 + random() * 0.46;
    target = currentBet + (contestedPot + toCall) * size;
  }
  return clamp(Math.round(target / 5) * 5, minRaiseTo, Math.max(minRaiseTo, effectiveRaiseTo));
}

export function chooseMove(view, random = Math.random) {
  const profile = DIFFICULTIES.find(level => level.id === view.difficulty) ?? DIFFICULTIES[0];
  const { toCall, contestedPot, canRaise, ownBet, currentBet, street, onButton } = view;
  const equity = clamp(sampleEquity(view, profile, random) + (random() - 0.5) * profile.error, 0, 1);
  const odds = toCall ? toCall / (contestedPot + toCall) : 0;
  const opening = street === 0 && currentBet === BIG_BLIND;
  const expensive = toCall > Math.max(BIG_BLIND * 3, contestedPot * 0.34);
  const positionCost = profile.reads && !onButton && street < 3 ? 0.035 : 0;
  const callLine = odds + profile.callEdge + positionCost + (expensive ? 0.08 : 0.015);
  const { lastAction } = view;
  const checkedTo = lastAction?.street === street && lastAction.move === 'check';
  const multiway = view.opponents.length - 1;
  const valueLine = profile.valueLine - .052 * multiway + (toCall && !opening ? 0.09 : 0) - (checkedTo ? 0.04 : 0);
  const canPressure = !expensive && (toCall === 0 || opening) && equity >= 0.20 && equity < 0.53;
  const fire = equity >= valueLine
    ? profile.aggression + (equity > 0.84 ? 0.14 : 0)
    : canPressure ? profile.bluff * (onButton || checkedTo ? 1.32 : 0.76) / (1 + .65 * multiway) : 0;

  if (canRaise && currentBet >= ownBet && random() < fire) {
    return { move: 'raise', amount: raiseAmount(view, profile, equity, random) };
  }
  if (toCall && equity < callLine) return { move: 'fold' };
  return { move: 'call' };
}
