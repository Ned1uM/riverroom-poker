import { BIG_BLIND, SMALL_BLIND, handName, rankHand, rankOf, suitOf } from './engine.mjs';
import { sampleEquity, startingStrength } from './opponent.mjs';

const PROFILE = { samples: 2400, reads: 0.85 };
const OPEN_LINES = { buttonSmallBlind: 0.57, button: 0.63, smallBlind: 0.67, bigBlind: 0.70, cutoff: 0.66, hijack: 0.70 };

function describeHand({ pocket, board }) {
  if (board.length) return handName(rankHand([...pocket, ...board]));
  if (rankOf(pocket[0]) === rankOf(pocket[1])) return '口袋对子';
  return suitOf(pocket[0]) === suitOf(pocket[1]) ? '同花起手牌' : '杂色起手牌';
}

function raiseSuggestion(view, opening, reason) {
  const { currentBet, contestedPot, toCall, minRaiseTo, effectiveRaiseTo, maxRaiseTo } = view.options;
  const callers = view.opponents.filter(({ actions }) => actions.some(action => action.street === 0 && action.move === 'call')).length;
  const proposed = opening ? (2.5 + Math.min(3, callers)) * BIG_BLIND
    : currentBet + (contestedPot + toCall) * (view.opponents.length > 1 ? 0.65 : 0.5);
  const rounded = Math.round(proposed / SMALL_BLIND) * SMALL_BLIND;
  const amount = Math.max(minRaiseTo, Math.min(effectiveRaiseTo, rounded));
  return { move: currentBet ? 'raise' : 'bet', amount, allIn: amount === maxRaiseTo, reason };
}

function recommend(view, equity, callOdds) {
  const { toCall, currentBet, canRaise } = view.options;
  const opening = view.street === 0 && currentBet === BIG_BLIND;
  if (opening && canRaise && startingStrength(view.pocket) >= OPEN_LINES[view.role]) {
    return raiseSuggestion(view, true, '这手起手牌在你的位置适合主动加注，争取减少看翻牌的对手。');
  }

  const positionMargin = view.futureBetting ? (view.actsLastPostflop ? 0.025 : 0.06) : 0;
  if (toCall && equity < callOdds + positionMargin) {
    const reason = equity < callOdds ? '当前估算的摊牌权益低于跟注所需权益，继续投入的价格偏高。'
      : '权益接近跟注门槛，后续仍可能遇到下注，这个位置可以保守一点。';
    return { move: 'fold', reason };
  }

  const valueLine = 0.60 - 0.055 * (view.opponents.length - 1) + (toCall ? 0.09 : 0) + positionMargin;
  if (!opening && canRaise && equity >= valueLine) {
    return raiseSuggestion(view, false, '这手牌对当前对手范围有较明显的权益优势，可以主动争取价值。');
  }

  if (toCall) {
    return {
      move: 'call',
      amount: toCall,
      allIn: toCall === view.stack,
      reason: '估算的摊牌权益达到这次跟注所需的门槛，当前价格可以接受。',
    };
  }
  return { move: 'check', reason: '你现在可以免费过牌，保留摊牌机会，同时控制底池大小。' };
}

export function analyze(view, random = Math.random) {
  const equity = sampleEquity(view, PROFILE, random);
  const { toCall, contestedPot } = view.options ?? {};
  const callOdds = toCall ? toCall / (contestedPot + toCall) : null;
  return {
    equity,
    callOdds,
    handType: describeHand(view),
    suggestion: view.options ? recommend(view, equity, callOdds) : null,
  };
}
