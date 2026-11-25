import {
  PLAYER, SEAT_COUNTS, SMALL_BLIND, STREETS, act, actionOptions, advanceRunout, bestFive, createGame,
  handName, matchEnded, opponentView, playerView, potSize, rankHand, rankOf, seatRole, startHand, suitOf,
} from './engine.mjs';
import { DIFFICULTIES, chooseMove } from './opponent.mjs';
import { animateCards } from './motion.mjs';
import { analyze } from './advisor.mjs';
import { SUIT_NAMES as suitNames, SUIT_SYMBOLS as suits, renderSuitedFace } from './card-face.mjs';

const byId = id => document.getElementById(id);
const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const seatPositions = { 2: [50, 50], 3: [50, 27, 73], 4: [50, 20, 50, 80], 5: [50, 17, 29, 71, 83] };
const positionNames = {
  button: '庄家', buttonSmallBlind: '庄家兼小盲', smallBlind: '小盲位',
  bigBlind: '大盲位', cutoff: '关煞位', hijack: '劫位',
};
const positionCodes = { button: 'BTN', buttonSmallBlind: 'BTN / SB', smallBlind: 'SB', bigBlind: 'BB', cutoff: 'CO', hijack: 'HJ' };
const moveNames = { small: '下小盲', big: '下大盲', fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注至' };
const seatMoveNames = { ...moveNames, small: '小盲', big: '大盲', raise: '加注' };
const ui = {
  table: byId('table'), deck: byId('deck'), flights: byId('card-flights'),
  lobby: byId('table-lobby'), start: byId('start'), controls: byId('controls'), aside: byId('room-aside'),
  handNumber: byId('hand-number'), street: byId('street'), seats: byId('seats'), mode: byId('game-mode'),
  countSelect: byId('seat-count-select'), countOptions: byId('seat-count-options'),
  countDescription: byId('seat-count-description'),
  pot: byId('pot'), potLabel: byId('pot-label'), board: byId('board'), caption: byId('turn-caption'),
  betting: byId('betting-controls'), betConfig: byId('bet-config'), betLabel: byId('bet-label'),
  range: byId('bet-range'), betValue: byId('bet-value'), betGuidance: byId('bet-guidance'),
  sizeButtons: [...document.querySelectorAll('[data-size]')],
  fixedButtons: [...document.querySelectorAll('[data-amount]')],
  fold: byId('fold'), call: byId('call'), raise: byId('raise'),
  end: byId('end-controls'), resultTitle: byId('result-title'), resultDetail: byId('result-detail'), next: byId('next-hand'),
  difficultySelect: byId('difficulty-select'), difficultyOptions: byId('difficulty-options'),
  difficultyDescription: byId('difficulty-description'),
  historyPanel: byId('history-panel'), history: byId('hand-log'), historyScroll: byId('history-scroll'), reset: byId('reset'),
};
const showdown = {
  button: byId('open-showdown'), dialog: byId('showdown-dialog'),
  pots: byId('showdown-pots'), hands: byId('showdown-hands'),
};
const advisor = {
  button: byId('open-advisor'), dialog: byId('advisor-dialog'), details: byId('advisor-details'),
  context: byId('advisor-context'), pocket: byId('advisor-pocket'), handType: byId('advisor-hand-type'),
  boardRow: byId('advisor-board-row'), board: byId('advisor-board'),
  equity: byId('advisor-equity'), odds: byId('advisor-odds'), pot: byId('advisor-pot'),
  decision: byId('advisor-decision'), reason: byId('advisor-reason'),
};
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format;

const difficultyStorage = 'riverroom-difficulty';
const countStorage = 'riverroom-seat-count';
function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The setting still applies on this page. */ }
}

const savedCount = Number(readPreference(countStorage));
let difficulty = DIFFICULTIES.find(level => level.id === readPreference(difficultyStorage)) ?? DIFFICULTIES[0];
let game = createGame(SEAT_COUNTS.includes(savedCount) ? savedCount : 2);
let seatViews = [];
let timer;
let betStops = [];
let renderedHand;
let cardMotion;
let adviceCache;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function seatName(seat) {
  return seat === PLAYER ? '你' : game.stacks.length === 2 ? 'AI' : `AI ${seat}`;
}

function actionText({ move, amount, allIn }) {
  const value = amount ? ` ${format(amount)}` : '';
  return `${moveNames[move]}${value}${allIn ? '（全下）' : ''}`;
}

function cardsText(cards) {
  return cards.map(card => `${ranks[rankOf(card) - 2]}${suits[suitOf(card)]}`).join(' ');
}

function buildSeats() {
  const count = game.stacks.length;
  seatViews = seatPositions[count].map((left, seat) => {
    const player = seat === PLAYER;
    const spot = element('div', 'seat-spot');
    spot.dataset.seat = seat;
    spot.style.setProperty('--seat-x', `${left}%`);
    spot.classList.toggle('seat-spot--lower', player || (count === 5 && (seat === 1 || seat === 4)));
    const tag = element('div', 'seat');
    const avatar = element('span', `avatar avatar--${player ? 'player' : 'computer'}`, player ? '♠' : undefined);
    avatar.setAttribute('aria-hidden', 'true');
    if (!player) avatar.append(element('span', 'robot'));
    const text = element('div', 'seat-text');
    const stack = element('span', 'seat-stack');
    const label = !player && count === 2 ? 'AI 对手' : seatName(seat);
    text.append(element('span', 'seat-name', label), stack);
    const identity = element('div', 'seat-identity');
    identity.append(avatar, text);
    const position = element('span', 'seat-position');
    tag.append(identity, position);
    const action = player ? null : element('div', 'seat-action');
    if (action) {
      action.hidden = true;
      action.setAttribute('role', 'status');
      tag.append(action);
    }
    const pocket = element('div', `pocket pocket--${player ? 'player' : 'computer'}`);
    pocket.setAttribute('aria-label', player ? '你的手牌' : `${label}手牌`);
    spot.append(tag, pocket);
    return { spot, tag, stack, position, pocket, action };
  });
  ui.seats.replaceChildren(...seatViews.map(view => view.spot));
  ui.table.dataset.seatCount = count;
  ui.table.classList.toggle('is-multiway', count > 2);
  ui.mode.textContent = count === 2 ? '单挑' : `${count} 人桌`;
}

function cardNode(card) {
  const node = element('div', 'card');
  node.dataset.card = card;
  if (card === 'blank' || card === 'back') {
    const faceDown = card === 'back';
    node.classList.add(faceDown ? 'card--back' : 'card--blank');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', faceDown ? '盖着的牌' : '公共牌待揭晓');
    const mark = element('span', 'card-mark', faceDown ? '♠' : '◇');
    mark.setAttribute('aria-hidden', 'true');
    node.append(mark);
    return node;
  }

  node.setAttribute('role', 'img');
  renderSuitedFace(node, ranks[rankOf(card) - 2], suitOf(card));
  return node;
}

function buildSuitExamples() {
  const examples = byId('suit-examples');
  for (const [suit, name] of suitNames.entries()) {
    const example = element('figure', 'suit-example');
    const ace = (suit + 1) * ranks.length - 1;
    example.append(cardNode(ace), element('figcaption', '', name));
    examples.append(example);
  }
}

function buildHandExamples() {
  const examples = [
    ['A♠ K♠ Q♠ J♠ 10♠', 5, '同一花色的 A、K、Q、J、10。'],
    ['9♥ 8♥ 7♥ 6♥ 5♥', 5, '五张同花色的连续牌。'],
    ['Q♠ Q♥ Q♣ Q♦ 8♣', 4, '四张同点数的牌。'],
    ['K♠ K♥ K♣ 5♠ 5♦', 5, '三张同点数加上一对。'],
    ['A♦ J♦ 8♦ 4♦ 2♦', 5, '五张同花色的牌。'],
    ['10♣ 9♥ 8♠ 7♦ 6♣', 5, '五张点数连续的牌。'],
    ['7♠ 7♥ 7♦ J♣ 4♣', 3, '三张同点数的牌。'],
    ['K♠ K♦ 5♣ 5♥ 9♦', 4, '两个不同点数的对子。'],
    ['10♠ 10♥ A♣ 7♦ 4♣', 2, '两张同点数的牌。'],
    ['A♠ J♥ 9♣ 6♦ 3♣', 1, '无其他牌型，先比较最高点数。'],
  ];
  const list = byId('hand-examples');
  for (const [notation, emphasis, detail] of examples) {
    const cards = notation.split(' ').map(face => suits.indexOf(face.at(-1)) * ranks.length + ranks.indexOf(face.slice(0, -1)));
    const item = element('li', 'hand-example');
    const figure = element('figure', 'hand-figure');
    const label = element('figcaption', 'hand-figure-name', handName(rankHand(cards)));
    const graphic = element('div', 'example-cards');
    const faces = cards.map((card, index) => {
      const face = cardNode(card);
      face.classList.toggle('example-kicker', index >= emphasis);
      return face;
    });
    graphic.append(...faces);
    figure.append(label, graphic, element('p', 'hand-figure-detail', detail));
    item.append(figure);
    list.append(item);
  }
}

function renderCards(container, cards, force = false) {
  const changed = [];
  for (const [index, card] of cards.entries()) {
    const displayed = container.children[index];
    if (!force && displayed?.dataset.card === String(card)) continue;
    const previousTransform = displayed?.dataset.card === 'back' && card !== 'back'
      ? getComputedStyle(displayed).transform : 'none';
    const node = cardNode(card);
    if (displayed) displayed.replaceWith(node);
    else container.append(node);
    if (card !== 'blank') changed.push({ node, previousTransform });
  }
  while (container.childElementCount > cards.length) container.lastElementChild.remove();
  return changed;
}

function renderHandCards() {
  const { hand } = game;
  const newHand = hand !== renderedHand;
  const showdown = hand.result?.reason === 'showdown';
  const pockets = seatViews.map(({ pocket }, seat) => {
    const dealt = hand.pockets[seat];
    const visible = seat === PLAYER || (showdown && hand.inHand[seat]) ? dealt : dealt.map(() => 'back');
    return renderCards(pocket, visible, newHand);
  });
  const board = renderCards(ui.board, Array.from({ length: 5 }, (_, index) => hand.board[index] ?? 'blank'));

  if (newHand) {
    return { kind: 'deal', cards: [0, 1].flatMap(card => hand.dealOrder.map(seat => pockets[seat][card])) };
  }
  if (board.length) return { kind: 'board', cards: board };
  const revealed = hand.dealOrder.filter(seat => seat !== PLAYER).flatMap(seat => pockets[seat]);
  if (showdown && revealed.length) return { kind: 'showdown', cards: revealed };
  return null;
}

function renderSeat(view, seat, hand, stack, motion) {
  const ended = hand?.phase === 'ended';
  const settling = motion === 'showdown';
  const dealt = Boolean(hand?.pockets[seat].length);
  const out = (hand && !dealt) || (ended && !settling && stack === 0);
  const folded = dealt && !hand.inHand[seat];
  view.spot.dataset.status = out ? 'out' : folded ? 'folded' : 'ready';
  view.tag.classList.toggle('is-active', !motion && hand?.toAct === seat);
  view.tag.classList.toggle('is-winner', !settling && ended && hand.result.payouts[seat] > 0);
  if (!settling) view.stack.textContent = out ? '出局' : stack === 0 ? '全下' : format(stack);
  const role = seatRole(hand, seat);
  view.position.hidden = !role;
  view.position.textContent = positionNames[role] ?? '';
  view.position.title = positionCodes[role] ?? '';
  view.position.classList.toggle('is-button', role === 'button' || role === 'buttonSmallBlind');
}

function renderSeatAction(node, seat, hand, event, isLatest) {
  node.hidden = !hand?.pockets[seat].length;
  if (node.hidden) {
    if (node.childElementCount) node.replaceChildren();
    delete node.dataset.readout;
    return;
  }

  const stage = event ? STREETS[event.street] : '';
  const prior = event && event.street !== hand.street && event.move !== 'fold' && !event.allIn
    ? (event.street === 0 ? '翻前' : stage) : '';
  const text = event ? `${stage} · ${actionText(event)}` : '待行动';
  node.dataset.latest = String(isLatest);
  node.dataset.move = event?.allIn ? 'all-in' : event?.move ?? 'pending';
  const readout = `${hand.number} ${text} ${prior}`;
  if (node.dataset.readout === readout) return;
  node.dataset.readout = readout;
  node.title = text;

  const description = element('span', 'seat-action-announcement', `${seatName(seat)} ${text}`);
  const label = element('span', 'seat-action-label');
  label.setAttribute('aria-hidden', 'true');
  if (prior) label.append(element('span', 'seat-action-street', prior));
  label.append(event ? (event.allIn ? '全下' : seatMoveNames[event.move]) : '待行动');
  node.replaceChildren(description, label);
  if (event?.amount) {
    const prefix = event.move === 'raise' && !event.allIn ? '至 ' : '';
    const value = element('span', 'seat-action-value', `${prefix}${format(event.amount)}`);
    value.setAttribute('aria-hidden', 'true');
    node.append(value);
  }
}

function renderTable(motion, opening) {
  const { hand, stacks } = game;
  const isShowdown = hand?.result?.reason === 'showdown';
  const ended = hand?.phase === 'ended';
  const settling = motion === 'showdown';
  ui.handNumber.hidden = !hand;
  ui.handNumber.textContent = hand ? `第 ${String(hand.number).padStart(2, '0')} 手` : '';
  ui.street.textContent = isShowdown ? '摊牌' : STREETS[hand?.street] ?? '待开局';
  if (!settling) {
    ui.pot.textContent = format(hand ? potSize(hand) : 0);
    ui.potLabel.textContent = ended ? '底池已结算' : '底池';
  }
  const seatActions = [];
  let latest;
  for (const event of hand?.log ?? []) {
    if (event.seat !== PLAYER && (event.kind === 'action' || event.kind === 'blind')) {
      seatActions[event.seat] = event;
      latest = event;
    }
  }
  seatViews.forEach((view, seat) => {
    renderSeat(view, seat, hand, stacks[seat], motion);
    if (view.action) renderSeatAction(view.action, seat, hand, seatActions[seat], latest?.seat === seat);
  });

  let caption;
  let turn;
  if (!hand) {
    caption = '';
    turn = 'idle';
  } else if (motion) {
    caption = motion === 'showdown' ? '摊牌中…'
      : motion === 'board' ? `${STREETS[hand.street]} · 发牌中…`
      : opening ? '新一局 · 发牌中…' : '发牌中…';
    turn = 'dealing';
  } else if (isShowdown) {
    const ranks = hand.result.scores.flatMap((score, seat) => score === null ? [] : [`${seatName(seat)} ${handName(score)}`]);
    caption = ranks.length === 2 && stacks.length === 2 ? ranks.join(' · ')
      : hand.inHand[PLAYER] ? `你 ${handName(hand.result.scores[PLAYER])} · 摊牌结束` : '摊牌结束';
    turn = 'ended';
  } else if (ended) {
    caption = '本手结束';
    turn = 'ended';
  } else if (hand.phase === 'runout') {
    caption = '全下 · 发完公共牌';
    turn = 'runout';
  } else if (hand.toAct === PLAYER) {
    caption = '轮到你行动';
    turn = 'player';
  } else {
    caption = `${seatName(hand.toAct)} 思考中…`;
    turn = 'computer';
  }
  ui.table.dataset.turn = turn;
  if (ui.caption.textContent !== caption) ui.caption.textContent = caption;
}

function buttonText(button, label, amount = 0) {
  const text = document.createTextNode(label);
  if (amount) button.replaceChildren(text, element('span', 'action-amount', format(amount)));
  else button.replaceChildren(text);
}

function sliderStops({ minRaiseTo, maxRaiseTo }) {
  const stops = [minRaiseTo];
  const firstRoundAmount = (Math.floor(minRaiseTo / SMALL_BLIND) + 1) * SMALL_BLIND;
  for (let amount = firstRoundAmount; amount < maxRaiseTo; amount += SMALL_BLIND) stops.push(amount);
  if (maxRaiseTo > minRaiseTo) stops.push(maxRaiseTo);
  return stops;
}

function nearestStop(amount) {
  const upper = betStops.findIndex(stop => stop >= amount);
  if (upper <= 0) return 0;
  return amount - betStops[upper - 1] <= betStops[upper] - amount ? upper - 1 : upper;
}

function updateBetAmount(options) {
  ui.betLabel.textContent = options?.currentBet ? '加注至' : '下注额';
  const label = options?.currentBet ? '加注' : '下注';
  const enabled = betStops.length > 0;
  const amount = ui.betValue.valueAsNumber;
  const valid = enabled && Number.isInteger(amount) && amount >= options.minRaiseTo && amount <= options.maxRaiseTo;
  ui.raise.disabled = !valid;
  ui.betValue.setAttribute('aria-invalid', String(enabled && !valid));
  ui.betGuidance.hidden = !enabled;
  for (const button of ui.fixedButtons) button.dataset.selected = String(valid && Number(button.dataset.amount) === amount);
  buttonText(ui.raise, valid && amount === options.maxRaiseTo ? '全下' : label, valid ? amount : 0);
  if (!enabled) {
    ui.range.removeAttribute('aria-valuetext');
    ui.range.style.setProperty('--fill', '0%');
    return;
  }

  const { minRaiseTo, maxRaiseTo } = options;
  if (valid) ui.range.value = nearestStop(amount);
  const stop = Number(ui.range.value);
  const lastStop = betStops.length - 1;
  ui.range.setAttribute('aria-valuetext', format(betStops[stop]));
  const fill = lastStop ? stop / lastStop * 100 : 100;
  ui.range.style.setProperty('--fill', `${fill}%`);

  const singleAmount = minRaiseTo === maxRaiseTo;
  const limits = singleAmount ? format(minRaiseTo) : `${format(minRaiseTo)} 至 ${format(maxRaiseTo)}`;
  const guidance = valid ? `可用金额 ${limits}` : singleAmount ? `请输入 ${limits}。` : `请输入 ${limits} 之间的整数。`;
  ui.betGuidance.dataset.warning = String(!valid);
  if (ui.betGuidance.textContent !== guidance) ui.betGuidance.textContent = guidance;
}

function renderControls(wasFocused = false) {
  const { hand, stacks } = game;
  const ended = hand.phase === 'ended' && !cardMotion;
  const focusBetting = ui.betting.contains(document.activeElement) || (wasFocused && document.activeElement === document.body);
  ui.end.hidden = !ended;
  ui.betting.hidden = ended;
  showdown.button.hidden = !ended || hand.result.reason !== 'showdown';
  if (ended) {
    const { net, pots, payouts } = hand.result;
    const winners = payouts.flatMap((amount, seat) => amount > 0 ? [seat] : []);
    const matchOver = matchEnded(game);
    let title = pots.length > 1 ? '主池和边池已结算' : '平分底池';
    if (winners.length === 1) title = winners[0] === PLAYER ? '你赢了本手' : `${seatName(winners[0])} 赢了本手`;
    if (matchOver) title = stacks[PLAYER] > 0 ? '你赢下了整局' : stacks.length === 2 ? 'AI 赢下了整局' : '你已出局';
    ui.resultTitle.textContent = title;
    ui.resultTitle.dataset.outcome = net > 0 ? 'win' : 'neutral';
    ui.resultDetail.textContent = net === 0 ? `本手净额 ${format(0)}` : `本手净${net > 0 ? '赢' : '输'} ${format(Math.abs(net))}`;
    ui.next.textContent = matchOver ? '准备下一局' : '下一手';
    if (focusBetting) ui.next.focus({ preventScroll: true });
    return;
  }

  const options = actionOptions(game);
  const isPlayer = !cardMotion && options?.seat === PLAYER;
  const canRaise = isPlayer && options.canRaise;
  betStops = canRaise ? sliderStops(options) : [];
  ui.fold.disabled = !isPlayer;
  ui.call.disabled = !isPlayer;
  ui.betValue.disabled = !canRaise;
  ui.betValue.min = canRaise ? options.minRaiseTo : '';
  ui.betValue.max = canRaise ? options.maxRaiseTo : '';
  ui.betValue.value = canRaise ? options.minRaiseTo : '';
  ui.range.max = Math.max(0, betStops.length - 1);
  ui.range.value = 0;
  ui.range.disabled = betStops.length < 2;
  ui.betConfig.classList.toggle('is-disabled', !canRaise);
  for (const button of ui.sizeButtons) button.disabled = !canRaise;
  for (const button of ui.fixedButtons) {
    const amount = Number(button.dataset.amount);
    button.disabled = !canRaise || amount < options.minRaiseTo || amount > options.maxRaiseTo;
  }
  const call = isPlayer ? options.toCall : 0;
  buttonText(ui.call, isPlayer ? (call ? '跟注' : '过牌') : '过牌 / 跟注', call);
  ui.call.title = call && call === stacks[PLAYER] ? '跟注并全下' : '';
  updateBetAmount(options);
}

function renderAdvisor() {
  if (!advisor.dialog.open) return;
  const { hand } = game;
  const view = cardMotion ? null : playerView(game);
  advisor.details.hidden = !view;
  if (!view) {
    advisor.decision.textContent = cardMotion ? '等待发牌' : hand?.phase === 'ended' ? '本手已结束' : '你已弃牌';
    advisor.reason.textContent = cardMotion ? '牌面更新后会自动分析。' : hand?.phase === 'ended'
      ? '下一手开始后可以查看新的行动建议。' : '可以返回牌桌，继续观看这一手。';
    return;
  }

  if (adviceCache?.hand !== hand || adviceCache.logLength !== hand.log.length) {
    adviceCache = { hand, logLength: hand.log.length, result: analyze(view) };
  }
  const { equity, callOdds, handType, suggestion } = adviceCache.result;
  advisor.context.textContent = `${STREETS[view.street]} · ${positionNames[view.role]} · ${view.opponents.length} 位对手`;
  advisor.pocket.textContent = cardsText(view.pocket);
  advisor.handType.textContent = handType;
  advisor.boardRow.hidden = view.board.length === 0;
  advisor.board.textContent = cardsText(view.board);
  advisor.equity.textContent = `约 ${percent(equity)}`;
  advisor.odds.textContent = callOdds !== null ? percent(callOdds) : view.options ? '无需跟注' : '待行动';
  advisor.pot.textContent = format(view.pot);
  if (suggestion) {
    advisor.decision.textContent = `建议 ${actionText(suggestion)}`;
    advisor.reason.textContent = suggestion.reason;
  } else if (hand.phase === 'runout' || !view.stack) {
    advisor.decision.textContent = hand.phase === 'runout' ? '等待摊牌' : '你已全下';
    advisor.reason.textContent = '公共牌和对手行动变化时，估算会更新。';
  } else {
    advisor.decision.textContent = '等待对手行动';
    advisor.reason.textContent = '轮到你时会显示可选行动和建议。';
  }
}

function potResultText(winners, index, count) {
  const pot = count === 1 ? '底池' : index === 0 ? '主池' : `边池${count > 2 ? ` ${index}` : ''}`;
  const names = winners.map(seatName).join('、');
  return `${names} ${winners.length === 1 ? '赢得' : '平分'}${pot}`;
}

function openShowdown() {
  const { hand } = game;
  if (cardMotion || hand?.result?.reason !== 'showdown') return;
  const { pots, scores } = hand.result;
  const winningSeats = new Set(pots.flatMap(pot => pot.winners));
  const potRows = pots.map(({ amount, winners }, index) => {
    const row = element('li');
    row.append(element('span', '', potResultText(winners, index, pots.length)), element('strong', '', format(amount)));
    return row;
  });
  const winningHands = [...winningSeats].map(seat => {
    const row = element('li');
    const name = element('h3', 'showdown-name');
    name.append(element('strong', '', seatName(seat)), element('span', '', handName(scores[seat])));
    const cards = element('div', 'showdown-cards');
    cards.setAttribute('role', 'group');
    cards.setAttribute('aria-label', '组成获胜牌型的五张牌');
    cards.append(...bestFive(hand.pockets[seat], hand.board, scores[seat]).map(cardNode));
    row.append(name, cards);
    return row;
  });
  showdown.pots.replaceChildren(...potRows);
  showdown.hands.replaceChildren(...winningHands);
  showdown.dialog.showModal();
}

function historyLine(event) {
  if (event.kind === 'street') return element('li', 'log-street', STREETS[event.street]);
  if (event.kind === 'result') {
    const winner = potResultText(event.winners, event.index, event.potCount);
    const result = element('li', 'log-result');
    result.append(element('span', '', winner), element('strong', '', format(event.amount)));
    return result;
  }
  const line = element('li', 'log-line');
  const move = event.kind === 'rank' ? handName(event.score) : event.kind === 'refund' ? '退回筹码' : moveNames[event.move];
  line.append(
    element('span', `log-seat log-seat--${event.seat === PLAYER ? 'player' : 'ai'}`, seatName(event.seat)),
    element('span', 'log-move', event.allIn ? `${move}（全下）` : move),
  );
  if (event.amount) line.append(element('strong', 'log-amount', format(event.amount)));
  return line;
}

function renderHistory() {
  const { hand } = game;
  const currentHand = renderedHand === hand;
  const atBottom = ui.historyScroll.scrollHeight - ui.historyScroll.scrollTop - ui.historyScroll.clientHeight < 20;
  if (!currentHand) {
    ui.history.replaceChildren();
    renderedHand = hand;
  }
  const additions = hand.log.slice(ui.history.childElementCount).map(historyLine);
  ui.history.append(...additions);
  if (!currentHand || atBottom) ui.historyScroll.scrollTop = ui.historyScroll.scrollHeight;
}

function renderDifficulty() {
  for (const button of ui.difficultyOptions.children) {
    button.setAttribute('aria-pressed', String(button.dataset.level === difficulty.id));
  }
  ui.difficultySelect.value = difficulty.id;
  ui.difficultyDescription.textContent = difficulty.description;
}

function setDifficulty(id) {
  const next = DIFFICULTIES.find(level => level.id === id);
  if (!next) return;
  difficulty = next;
  if (game.hand) game.hand.difficulty = id;
  savePreference(difficultyStorage, id);
  renderDifficulty();
}

function buildDifficultyControls() {
  for (const [index, level] of DIFFICULTIES.entries()) {
    ui.difficultySelect.add(new Option(level.label, level.id));
    const button = element('button', 'difficulty-tile');
    button.type = 'button';
    button.dataset.level = level.id;
    const meter = element('span', 'level-meter');
    meter.setAttribute('aria-hidden', 'true');
    for (let bar = 0; bar < DIFFICULTIES.length; bar++) {
      meter.append(element('i', bar <= index ? 'filled' : ''));
    }
    button.append(meter, element('span', '', level.label));
    button.addEventListener('click', () => setDifficulty(level.id));
    ui.difficultyOptions.append(button);
  }
  ui.difficultySelect.addEventListener('change', event => setDifficulty(event.target.value));
}

function renderSeatCount() {
  const count = game.stacks.length;
  const locked = Boolean(game.hand);
  ui.countSelect.value = count;
  ui.countSelect.disabled = locked;
  ui.countDescription.textContent = locked ? '回到待开局即可切换人数。' : `你和 ${count - 1} 位 AI 对打。`;
  for (const button of ui.countOptions.children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.count) === count));
    button.disabled = locked;
  }
}

function setSeatCount(count) {
  if (game.hand || !SEAT_COUNTS.includes(count) || count === game.stacks.length) return;
  game = createGame(count);
  savePreference(countStorage, count);
  buildSeats();
  updateGame();
}

function buildSeatCountControls() {
  for (const count of SEAT_COUNTS) {
    const label = `${count} 人`;
    ui.countSelect.add(new Option(label, count));
    const button = element('button', 'seat-count-option', label);
    button.type = 'button';
    button.dataset.count = count;
    button.addEventListener('click', () => setSeatCount(count));
    ui.countOptions.append(button);
  }
  ui.countSelect.addEventListener('change', () => setSeatCount(Number(ui.countSelect.value)));
}

function scheduleNextAction(hand, afterAnimation) {
  if (hand.phase === 'runout') {
    timer = setTimeout(() => {
      if (hand !== game.hand) return;
      advanceRunout(game);
      updateGame();
    }, afterAnimation ? 360 : 450);
  } else if (hand.toAct !== null && hand.toAct !== PLAYER) {
    const seat = hand.toAct;
    timer = setTimeout(() => {
      if (hand !== game.hand || hand.toAct !== seat) return;
      const decision = chooseMove(opponentView(game));
      act(game, seat, decision.move, decision.amount);
      updateGame();
    }, 790 + Math.random() * 190);
  }
}

function updateGame() {
  betStops = [];
  clearTimeout(timer);
  if (cardMotion) {
    const interrupted = cardMotion;
    cardMotion = null;
    interrupted.cancel();
  }

  const { hand } = game;
  renderSeatCount();
  ui.lobby.hidden = Boolean(hand);
  ui.controls.hidden = !hand;
  ui.historyPanel.hidden = !hand;
  ui.aside.classList.toggle('is-idle', !hand);
  if (!hand) {
    if (advisor.dialog.open) advisor.dialog.close();
    renderedHand = null;
    adviceCache = null;
    for (const container of [...seatViews.map(view => view.pocket), ui.board, ui.history]) container.replaceChildren();
    renderTable();
    return;
  }

  const cue = renderHandCards();
  const opening = cue?.kind === 'deal' && hand.number === 1;
  const canAnimate = cue && !reducedMotion.matches && typeof ui.flights.animate === 'function';
  if (!canAnimate) {
    renderTable();
    renderControls();
    renderHistory();
    renderAdvisor();
    scheduleNextAction(hand, false);
    return;
  }

  const focused = ui.betting.contains(document.activeElement);
  renderTable(cue.kind, opening);
  const current = animateCards(ui.table, ui.deck, ui.flights, cue, opening);
  cardMotion = current;
  renderControls();
  if (cue.kind !== 'showdown') renderHistory();
  renderAdvisor();
  current.finished.then(() => {
    if (cardMotion !== current) return;
    cardMotion = null;
    renderTable();
    renderControls(focused);
    renderHistory();
    renderAdvisor();
    scheduleNextAction(hand, true);
  });
}

function takeTurn(move) {
  if (!cardMotion && act(game, PLAYER, move, ui.betValue.valueAsNumber)) updateGame();
}

function dealNext() {
  if (startHand(game, difficulty.id)) updateGame();
}

function returnToLobby() {
  game = createGame(game.stacks.length);
  updateGame();
  ui.start.focus();
}

ui.range.addEventListener('input', () => {
  if (betStops.length < 2) return;
  ui.betValue.value = betStops[Number(ui.range.value)];
  updateBetAmount(actionOptions(game));
});
for (const event of ['input', 'change']) {
  ui.betValue.addEventListener(event, () => {
    if (betStops.length) updateBetAmount(actionOptions(game));
  });
}
ui.betValue.addEventListener('keydown', event => {
  if (event.key === 'Enter') ui.betValue.blur();
});
for (const button of [...ui.sizeButtons, ...ui.fixedButtons]) {
  button.addEventListener('click', () => {
    const options = actionOptions(game);
    if (button.disabled || !betStops.length) return;
    const { size, amount } = button.dataset;
    let target;
    if (amount) target = Number(amount);
    else if (size === 'minimum') target = options.minRaiseTo;
    else if (size === 'all') target = options.maxRaiseTo;
    else target = Math.round(options.currentBet + (options.contestedPot + options.toCall) * Number(size));
    ui.betValue.value = Math.max(options.minRaiseTo, Math.min(options.maxRaiseTo, target));
    updateBetAmount(options);
  });
}
ui.fold.addEventListener('click', () => takeTurn('fold'));
ui.call.addEventListener('click', () => takeTurn('call'));
ui.raise.addEventListener('click', () => { if (!ui.raise.disabled) takeTurn('raise'); });
ui.start.addEventListener('click', dealNext);
ui.next.addEventListener('click', () => {
  if (matchEnded(game)) returnToLobby();
  else dealNext();
});

const rulesDialog = byId('rules-dialog');
const resetDialog = byId('reset-dialog');
document.querySelector('[data-open-rules]').addEventListener('click', () => rulesDialog.showModal());
showdown.button.addEventListener('click', openShowdown);
advisor.button.addEventListener('click', () => {
  advisor.dialog.showModal();
  renderAdvisor();
});
ui.reset.addEventListener('click', () => {
  resetDialog.returnValue = '';
  resetDialog.showModal();
});
resetDialog.addEventListener('close', () => {
  if (resetDialog.returnValue === 'reset') returnToLobby();
});
for (const dialog of [rulesDialog, resetDialog, advisor.dialog, showdown.dialog]) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}

buildSeats();
buildSeatCountControls();
buildDifficultyControls();
renderDifficulty();
buildSuitExamples();
buildHandExamples();
ui.deck.append(cardNode('back'));
reducedMotion.addEventListener?.('change', event => {
  if (event.matches) cardMotion?.cancel();
});
updateGame();
