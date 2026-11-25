import { beats, cardRank, classify, groupCards, isBomb, remainingRanks } from './doudizhu-engine.mjs';

export const DIFFICULTIES = Object.freeze([
  { id: 'beginner', level: 0, label: '初学者', description: '叫分更保守，倾向用低点数和简单牌型。', bidBias: -0.6 },
  { id: 'intermediate', level: 1, label: '进阶', description: '会保留整组牌和炸弹，也会给农民队友让牌。', bidBias: 0 },
  { id: 'advanced', level: 2, label: '高级', description: '会参考已出牌，在对手快出完时尝试压制。', bidBias: 0 },
  { id: 'expert', level: 3, label: '专家', description: '会估算几手能走完，再决定怎么拆牌和抢牌权。', bidBias: 0.15 },
]);
export const DEFAULT_DIFFICULTY = DIFFICULTIES[1];

function* runs(groups, copies, minimum) {
  for (let first = 3; first <= 14; first++) {
    const body = [];
    for (let high = first; high <= 14 && groups.get(high)?.length >= copies; high++) {
      body.push(...groups.get(high).slice(0, copies));
      const length = high - first + 1;
      if (length >= minimum) yield { first, high, length, body: [...body] };
    }
  }
}

function* wings(entries, units, width, maxPerRank, start = 0, hasJoker = false) {
  if (!units) {
    yield [];
    return;
  }
  for (let index = start; index < entries.length; index++) {
    const [rank, pile] = entries[index];
    const joker = rank >= 16;
    if (joker && hasJoker) continue;
    const count = Math.min(maxPerRank, units, Math.floor(pile.length / width));
    for (let take = 1; take <= count; take++) {
      const used = pile.slice(0, take * width);
      for (const tail of wings(entries, units - take, width, maxPerRank, index + 1, hasJoker || joker)) {
        yield [...used, ...tail];
      }
    }
  }
}

export function legalMoves(cards, current) {
  const groups = groupCards(cards);
  const moves = [];
  const add = selection => {
    const combo = classify(selection);
    if (beats(combo, current)) moves.push({ cards: selection, combo });
  };
  const attached = (body, rest, count) => {
    for (const extra of wings(rest, count, 1, 2)) add([...body, ...extra]);
    for (const extra of wings(rest, count, 2, 1)) add([...body, ...extra]);
  };
  for (const [rank, pile] of groups) {
    for (let count = 1; count <= pile.length; count++) add(pile.slice(0, count));
    if (pile.length < 3) continue;
    const rest = [...groups].filter(([other]) => other !== rank);
    attached(pile.slice(0, 3), rest, 1);
    if (pile.length === 4) attached(pile, rest, 2);
  }
  if (groups.has(16) && groups.has(17)) add([52, 53]);
  for (const { body } of runs(groups, 1, 5)) add(body);
  for (const { body } of runs(groups, 2, 3)) add(body);
  for (const { first, high, length, body } of runs(groups, 3, 2)) {
    add(body);
    attached(body, [...groups].filter(([rank]) => rank < first || rank > high), length);
  }
  return moves;
}

export function chooseBid({ cards, bid }, random = Math.random, difficulty = DEFAULT_DIFFICULTY) {
  const groups = groupCards(cards);
  let strength = difficulty.bidBias;
  for (const [rank, pile] of groups) {
    if (rank >= 16) strength += 1.9;
    if (rank === 15) strength += pile.length * 0.85;
    if (rank === 14) strength += pile.length * 0.42;
    if (pile.length === 4) strength += 3.3;
    if (pile.length === 3) strength += 0.45;
  }
  if (cards.includes(52) && cards.includes(53)) strength += 1.1;
  if (difficulty.level >= 2) {
    const sequences = [...runs(groups, 1, 5), ...runs(groups, 2, 3), ...runs(groups, 3, 2)];
    const longest = Math.max(0, ...sequences.map(sequence => sequence.body.length));
    const looseLows = [...groups].filter(([rank, pile]) => rank <= 8 && pile.length === 1).length;
    strength += longest * 0.14 - looseLows * 0.16;
  }
  strength += (random() - 0.5) * 0.8;
  const target = strength >= 7.4 ? 3 : strength >= 5.5 ? 2 : strength >= 3.4 ? 1 : 0;
  return target > bid ? target : 0;
}

function sameSide(view, other) {
  return (view.seat === view.landlord) === (other === view.landlord);
}

function splitCost(cards, groups) {
  let split = 0;
  for (const [rank, spent] of groupCards(cards)) {
    const before = groups.get(rank).length;
    if (spent.length < before) split += [0, 0, 3, 7, 22][before];
  }
  if (groups.has(16) && groups.has(17) && cards.filter(card => card >= 52).length === 1) split += 13;
  return split;
}

function hasHigherMatch(combo, counts) {
  return counts.slice(combo.rank + 1).some(count => count >= combo.size);
}

function rankedMoves(view, difficulty, unseen) {
  const { cards, trick } = view;
  const groups = groupCards(cards);
  const next = (view.seat + 1) % 3;
  const nextIsOpponent = !sameSide(view, next);
  const nextCount = view.counts[next];
  const score = move => {
    if (move.cards.length === cards.length) return -1000;
    const { combo } = move;
    const bomb = isBomb(combo) ? 34 : 0;
    if (difficulty.level === 0) {
      return bomb + combo.rank * 1.25 - Math.min(5, combo.size) * (trick ? 0 : 1.5);
    }
    const average = move.cards.reduce((total, card) => total + cardRank(card), 0) / move.cards.length;
    let value = splitCost(move.cards, groups) + bomb + average * 0.7 - move.cards.length * (trick ? 1 : 4.5);
    if (combo.kind === 'single' && nextCount === 1) {
      if (nextIsOpponent) value += (17 - combo.rank) * 3.2;
      else if (!trick) value -= (18 - combo.rank) * 2;
    }
    if (unseen && (combo.kind === 'single' || combo.kind === 'pair')) {
      const unmatched = !hasHigherMatch(combo, unseen);
      if (nextIsOpponent && nextCount === combo.size) {
        value += unmatched ? -9 : 15;
      } else if (unmatched) {
        value += cards.length <= 6 ? -7 : 2;
      }
    }
    return value;
  };
  return legalMoves(cards, trick?.combo).map(move => ({ move, score: score(move) }))
    .sort((left, right) => left.score - right.score);
}

export function orderMoves(view) {
  return rankedMoves(view, DEFAULT_DIFFICULTY).map(entry => entry.move.cards);
}

function without(cards, spent) {
  const used = new Set(spent);
  return cards.filter(card => !used.has(card));
}

function estimateTurns(cards, budget, memo) {
  if (!cards.length) return 0;
  if (classify(cards)) return 1;
  const signature = cards.map(cardRank).join(',');
  const cached = memo.get(signature);
  if (cached !== undefined) return cached;
  let best = groupCards(cards).size;
  if (!budget.left || best <= 2) return best;
  budget.left--;

  // Every complete plan must play the lowest rank at some point.
  const lowest = cardRank(cards.at(-1));
  const moves = legalMoves(cards).filter(move => move.cards.some(card => cardRank(card) === lowest))
    .sort((a, b) => b.cards.length - a.cards.length).slice(0, 4);
  for (const move of moves) {
    best = Math.min(best, 1 + estimateTurns(without(cards, move.cards), budget, memo));
    if (best === 2) break;
  }
  memo.set(signature, best);
  return best;
}

function plannedMove(cards, candidates, expert) {
  const memo = new Map();
  let best = candidates[0].move;
  let bestScore = Infinity;
  for (const { move, score } of candidates.slice(0, expert ? 8 : 6)) {
    const turns = estimateTurns(without(cards, move.cards), { left: expert ? 20 : 5 }, memo);
    const plannedScore = score * (expert ? 0.42 : 0.5) + turns * (expert ? 8 : 6);
    if (plannedScore < bestScore) {
      best = move;
      bestScore = plannedScore;
    }
  }
  return best;
}

export function choosePlay(view, difficulty = DEFAULT_DIFFICULTY) {
  const unseen = difficulty.level >= 2 ? remainingRanks(view.cards, view.playedCards ?? []) : null;
  let ranked = rankedMoves(view, difficulty, unseen);
  if (!ranked.length) return [];
  if (ranked[0].move.cards.length === view.cards.length) return ranked[0].move.cards;
  const next = (view.seat + 1) % 3;
  const current = view.trick?.combo;
  if (current && sameSide(view, view.trick.seat)) {
    const needsBlock = unseen && !sameSide(view, next) && view.counts[next] === current.size &&
      (current.kind === 'single' || current.kind === 'pair') && hasHigherMatch(current, unseen);
    if (!needsBlock) return [];
    ranked = ranked.filter(({ move }) => isBomb(move.combo) || !hasHigherMatch(move.combo, unseen));
    if (!ranked.length) return [];
  }
  const { move: first } = ranked[0];
  const expert = difficulty.level === 3;
  const choice = unseen ? plannedMove(view.cards, ranked, expert) : first;
  const danger = view.counts.some((count, seat) => !sameSide(view, seat) && count <= 3);
  if (current && isBomb(choice.combo) && !danger && view.cards.length > 6) {
    const canFinishNext = expert && classify(without(view.cards, choice.cards));
    if (!canFinishNext) return isBomb(first.combo) ? [] : first.cards;
  }
  return choice.cards;
}
