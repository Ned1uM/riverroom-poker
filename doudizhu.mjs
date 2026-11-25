import {
  COMBOS, PLAYER, beats, bid, cardRank, classify, createMatch, isBomb, play, remainingRanks, seatView, startRound,
} from './doudizhu-engine.mjs';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, chooseBid, choosePlay, orderMoves } from './doudizhu-ai.mjs';
import { renderSuitedFace } from './card-face.mjs';

const byId = name => document.getElementById(`ddz-${name}`);
const ui = {
  table: byId('table'), round: byId('round'), bottom: byId('bottom'), stake: byId('stake'),
  lobby: byId('lobby'), start: byId('start'), turn: byId('turn'), event: byId('event'),
  handArea: byId('hand-area'), hand: byId('hand'), controls: byId('controls'),
  bidControls: byId('bid-controls'), playControls: byId('play-controls'), selection: byId('selection'),
  bidButtons: [...document.querySelectorAll('[data-bid]')], pass: byId('pass'), hint: byId('hint'), play: byId('play'), clear: byId('clear'),
  summary: byId('summary'), resultTitle: byId('result-title'), resultDetail: byId('result-detail'), next: byId('next'),
  historyPanel: byId('history-panel'), history: byId('history'), historyScroll: byId('history-scroll'),
  difficulty: byId('difficulty'), difficultyDescription: byId('difficulty-description'),
  tracker: byId('tracker'), openTracker: byId('open-tracker'),
  trackerDescription: byId('tracker-description'), trackerCounts: byId('tracker-counts'), trackerTotal: byId('tracker-total'),
  rules: byId('rules'), openRules: byId('open-rules'),
};
const seats = ['你', 'AI 1', 'AI 2'].map((name, seat) => ({
  name, role: byId(`role-${seat}`), count: byId(`count-${seat}`),
  tag: byId(`seat-${seat}`), score: byId(`score-${seat}`), action: byId(`action-${seat}`),
}));

const ranks = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
const jokerArt = new URL('./joker-jester.png', import.meta.url).href;
const compact = window.matchMedia('(max-width: 570px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const difficultyStorage = 'riverroom-ddz-difficulty';
const match = createMatch();
const selected = new Set();
const trackerCells = new Map();
let difficulty = DEFAULT_DIFFICULTY;
let dealing = false;
let timer;
let loggedRound;
let hintMoves;
let hintIndex = 0;
let feedback = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function write(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function configureDifficulty() {
  for (const level of DIFFICULTIES) ui.difficulty.add(new Option(level.label, level.id));
  try {
    const saved = localStorage.getItem(difficultyStorage);
    difficulty = DIFFICULTIES.find(level => level.id === saved) ?? DEFAULT_DIFFICULTY;
  } catch { /* The select still works when storage is unavailable. */ }
  ui.difficulty.value = difficulty.id;
  write(ui.difficultyDescription, difficulty.description);
  ui.difficulty.addEventListener('change', () => {
    difficulty = DIFFICULTIES.find(level => level.id === ui.difficulty.value) ?? DEFAULT_DIFFICULTY;
    write(ui.difficultyDescription, difficulty.description);
    try { localStorage.setItem(difficultyStorage, difficulty.id); } catch { /* Use the current selection. */ }
  });
}

function rankLabel(rank) {
  return ranks[rank] ?? String(rank);
}

function cardLabel(card) {
  return rankLabel(cardRank(card));
}

function cardNode(card, handCard = false) {
  if (card === null) {
    const back = element('span', 'card card--back');
    back.setAttribute('role', 'img');
    back.setAttribute('aria-label', '盖着的底牌');
    const mark = element('span', 'card-mark', '♠');
    mark.setAttribute('aria-hidden', 'true');
    back.append(mark);
    return back;
  }

  const rank = cardLabel(card);
  const node = element(handCard ? 'button' : 'span', `card ${handCard ? 'ddz-hand-card' : 'ddz-mini'}`);
  if (handCard) {
    node.type = 'button';
    node.dataset.card = card;
  } else {
    node.setAttribute('role', 'img');
  }
  if (card < 52) {
    renderSuitedFace(node, rank, Math.floor(card / 13));
    return node;
  }

  node.classList.add('card--face', 'card--joker');
  node.classList.toggle('card--red', card === 53);
  node.setAttribute('aria-label', rank);
  node.title = rank;
  const print = element('span', 'card-print');
  print.setAttribute('aria-hidden', 'true');
  const figure = element('img', 'ddz-joker-figure');
  figure.src = jokerArt;
  figure.alt = '';
  figure.draggable = false;
  print.append(
    figure,
    element('span', 'ddz-joker-index', 'JOKER'),
    element('span', 'ddz-joker-index ddz-joker-index--opposite', 'JOKER'),
  );
  node.append(print);
  return node;
}

function renderCardLine(container, cards) {
  const key = JSON.stringify(cards);
  if (container.dataset.cards === key) return;
  container.dataset.cards = key;
  container.style.setProperty('--ddz-steps', Math.max(1, cards.length - 1));
  container.replaceChildren(...cards.map(card => cardNode(card)));
}

function renderHand(cards) {
  const key = `${compact.matches}/${cards.join(',')}`;
  if (ui.hand.dataset.cards === key) return;
  ui.hand.dataset.cards = key;
  const focusCard = document.activeElement?.dataset.card;
  const buttons = cards.map((card, index) => {
    const button = cardNode(card, true);
    button.style.setProperty('--ddz-index', index);
    return button;
  });
  const split = compact.matches && cards.length > 10 ? Math.ceil(cards.length / 2) : cards.length;
  const rows = [buttons.slice(0, split), buttons.slice(split)].filter(row => row.length).map(row => {
    const line = element('div', 'ddz-hand-row');
    line.style.setProperty('--ddz-steps', Math.max(1, row.length - 1));
    line.append(...row);
    return line;
  });
  ui.hand.replaceChildren(...rows);
  if (focusCard !== undefined) buttons.find(button => button.dataset.card === focusCard)?.focus({ preventScroll: true });
}

function signed(points) {
  return points > 0 ? `+${points}` : String(points);
}

function renderSeats(round) {
  for (const [seat, view] of seats.entries()) {
    const assigned = round?.landlord != null;
    const landlord = round?.landlord === seat;
    view.role.hidden = !assigned;
    view.role.dataset.role = landlord ? 'landlord' : 'farmer';
    write(view.role, landlord ? '地主' : '农民');
    const count = round?.hands[seat].length;
    view.count.hidden = count === undefined;
    view.count.dataset.low = String(count <= 2);
    write(view.count, count === undefined ? '' : `${count} 张`);
    view.tag?.classList.toggle('is-active', !dealing && round?.turn === seat);

    const points = match.scores[seat];
    view.score.dataset.sign = points === 0 ? 'neutral' : points > 0 ? 'positive' : 'negative';
    write(view.score, signed(points));
  }
}

// Keep each seat's latest action until a new lead actually starts the next trick.
function seatActions(round) {
  const actions = [null, null, null];
  if (!round) return actions;
  if (round.phase === 'bidding' || round.phase === 'redeal') {
    for (const event of round.log) if (event.kind === 'bid') actions[event.seat] = event;
    return actions;
  }
  let passes = 0;
  for (const event of round.log) {
    if (event.kind === 'play') {
      if (passes === 2) actions.fill(null);
      actions[event.seat] = event;
      passes = 0;
    } else if (event.kind === 'pass') {
      actions[event.seat] = event;
      passes++;
    }
  }
  return actions;
}

function renderSeatActions(round) {
  const actions = seatActions(round);
  for (const [seat, view] of seats.entries()) {
    const event = actions[seat];
    const current = round?.phase === 'playing' && event?.kind === 'play' && round.trick?.seat === seat;
    view.action.hidden = !event;
    view.action.classList.toggle('is-current', Boolean(current));
    if (!event) { view.action.replaceChildren(); continue; }
    const label = element('p', 'ddz-seat-action-label', `${current ? '当前需压 · ' : ''}${actionLabel(event)}`);
    view.action.replaceChildren(label);
    if (event.cards) {
      const cards = element('div', 'ddz-seat-action-cards');
      cards.setAttribute('role', 'group');
      cards.setAttribute('aria-label', `${view.name}出的牌`);
      cards.append(...event.cards.map(card => cardNode(card)));
      view.action.append(cards);
    }
  }
}

function actionLabel(event) {
  if (event.kind === 'bid') return event.points ? `叫 ${event.points} 分` : '不叫';
  if (event.kind === 'pass') return '不出';
  if (event.kind === 'landlord') return '成为地主';
  return `出 ${COMBOS[event.combo.kind]}`;
}

function eventText(event) {
  return `${seats[event.seat].name} ${actionLabel(event)}`;
}

function latestText(log) {
  const last = log.at(-1);
  if (!last) return '';
  if (last.kind === 'landlord') {
    const previous = log.at(-2);
    return previous.seat === last.seat ? `${eventText(previous)}，成为地主` : `${eventText(previous)} · ${eventText(last)}`;
  }
  if (last.combo && isBomb(last.combo)) return `${eventText(last)} · 倍数翻倍`;
  return eventText(last);
}

function turnText(round) {
  if (!round) return '';
  if (dealing) return '发牌中…';
  if (round.phase === 'redeal') return '三人都不叫，准备重新发牌';
  if (round.phase === 'ended') return `${seats[round.result.winner].name}先出完手牌`;
  const action = round.phase === 'bidding' ? '叫分'
    : round.trick ? '跟牌'
    : round.log.at(-1)?.kind === 'pass' ? '领出新一轮' : '出牌';
  return round.turn === PLAYER ? `轮到你${action}` : `${seats[round.turn].name} 正在${action}…`;
}

function renderTable(round) {
  ui.table.dataset.phase = round?.phase ?? 'idle';
  ui.table.dataset.you = String(!dealing && round?.turn === PLAYER);
  ui.table.classList.toggle('is-dealing', dealing);
  write(ui.round, round ? `第 ${round.number} 局` : '待开局');
  ui.stake.hidden = !round || !round.bid;
  write(ui.stake, !round?.bid ? '' : round.landlord === null ? `已叫 ${round.bid} 分` : `${round.bid} 分 × ${round.multiplier}`);
  renderCardLine(ui.bottom, round?.landlord != null ? round.bottom : [null, null, null]);
  renderSeats(round);

  ui.lobby.hidden = Boolean(round);
  renderSeatActions(round);
  write(ui.turn, turnText(round));
  write(ui.event, round ? latestText(round.log) : '');
  const lastCombo = round?.log.at(-1)?.combo;
  ui.event.dataset.bomb = String(Boolean(lastCombo && isBomb(lastCombo)));

  const cards = round?.hands[PLAYER] ?? [];
  ui.handArea.hidden = !round || cards.length === 0;
  renderHand(cards);
}

function followIssue(combo, current) {
  if (current.kind === 'rocket') return '上一手是王炸，只能不出';
  if (current.kind === 'bomb') return '需用更大的炸弹或王炸';
  if (combo.kind !== current.kind) return `需跟同牌型（${COMBOS[current.kind]}）`;
  if (combo.size !== current.size) return `需跟 ${current.size} 张${COMBOS[current.kind]}`;
  return '跟牌点数须高于上一手';
}

function renderSelection() {
  const { round } = match;
  const playing = !dealing && round?.phase === 'playing';
  for (const button of ui.hand.querySelectorAll('button')) {
    button.disabled = !playing;
    button.setAttribute('aria-pressed', String(selected.has(Number(button.dataset.card))));
  }

  const yourTurn = playing && round.turn === PLAYER;
  const combo = classify([...selected]);
  const current = round?.trick?.combo;
  const legal = beats(combo, current);
  ui.pass.disabled = !yourTurn || !round.trick;
  ui.hint.disabled = !yourTurn;
  ui.play.disabled = !yourTurn || !legal;
  ui.clear.disabled = !playing || !selected.size;

  let message;
  let warning = false;
  if (feedback) {
    message = feedback;
  } else if (selected.size) {
    const selection = `已选 ${selected.size} 张`;
    warning = !legal && yourTurn;
    const description = !combo ? '未组成合法牌型' : warning ? followIssue(combo, current) : COMBOS[combo.kind];
    message = `${selection} · ${description}`;
  } else if (!yourTurn) {
    message = '等对手行动时可以预选手牌。';
  } else if (round.trick) {
    message = `压过${seats[round.trick.seat].name}的${COMBOS[round.trick.combo.kind]}，或选择不出。`;
  } else {
    message = '点击手牌选中，组成牌型后出牌。';
  }
  ui.selection.dataset.warning = String(warning);
  write(ui.selection, message);
}

function renderControls(round) {
  const bidding = round?.phase === 'bidding';
  const playing = round?.phase === 'playing';
  const ended = round?.phase === 'ended';
  const wasFocused = ui.controls.contains(document.activeElement);
  ui.controls.hidden = !bidding && !playing;
  ui.bidControls.hidden = !bidding;
  ui.playControls.hidden = !playing;
  for (const button of ui.bidButtons) {
    const points = Number(button.dataset.bid);
    button.disabled = dealing || !bidding || round.turn !== PLAYER || (points > 0 && points <= round.bid);
  }
  renderSelection();

  ui.summary.hidden = !ended;
  if (!ended) return;
  const { result, landlord, bid: points, multiplier } = round;
  const winner = result.landlordWon ? '地主胜' : '农民胜';
  const won = (landlord === PLAYER) === result.landlordWon;
  write(ui.resultTitle, `${won ? '你获胜' : '你落败'} · ${winner}`);
  const spring = result.spring ? ` · ${result.spring}` : '';
  write(ui.resultDetail, `本局 ${signed(result.changes[PLAYER])} 分 · 底分 ${points} × ${multiplier} 倍${spring}`);
  if (wasFocused) ui.next.focus({ preventScroll: true });
}

function renderHistory(round) {
  ui.historyPanel.hidden = !round;
  if (!round) return;
  const atBottom = ui.historyScroll.scrollHeight - ui.historyScroll.scrollTop - ui.historyScroll.clientHeight < 24;
  const changedRound = loggedRound !== round;
  if (changedRound) {
    loggedRound = round;
    ui.history.replaceChildren();
  }
  for (const event of round.log.slice(ui.history.childElementCount)) {
    const line = element('li', 'log-line');
    line.append(
      element('span', `log-seat log-seat--${event.seat === PLAYER ? 'player' : 'ai'}`, seats[event.seat].name),
      element('span', 'log-move', actionLabel(event)),
    );
    if (event.cards) line.append(element('span', 'log-amount', event.cards.map(cardLabel).join(' ')));
    ui.history.append(line);
  }
  if (changedRound || atBottom) ui.historyScroll.scrollTop = ui.historyScroll.scrollHeight;
}

function renderTracker(round) {
  ui.trackerCounts.hidden = !round || dealing;
  ui.trackerTotal.hidden = ui.trackerCounts.hidden;
  if (ui.trackerCounts.hidden) {
    write(ui.trackerDescription, '发牌后可查看你手牌以外尚未打出的牌。');
    return;
  }

  const { cards, playedCards } = seatView(round, PLAYER);
  const counts = remainingRanks(cards, playedCards);
  const bottomNote = round.landlord === null ? '未分配的底牌也计入。'
    : round.landlord === PLAYER ? '你手里的底牌已扣除。' : '尚未打出的公开底牌也计入。';
  write(ui.trackerDescription, `每个数字是该点数在你手牌以外尚未打出的张数。${bottomNote}`);
  write(ui.trackerTotal, `合计 ${counts.reduce((total, count) => total + count, 0)} 张`);
  for (const [rank, count] of trackerCells) {
    write(count, String(counts[rank]));
    count.dataset.empty = String(counts[rank] === 0);
  }
}

function update() {
  clearTimeout(timer);
  hintMoves = null;
  hintIndex = 0;
  feedback = '';
  const { round } = match;
  renderTable(round);
  renderControls(round);
  renderHistory(round);
  if (ui.tracker.open) renderTracker(round);
  if (!round) return;

  if (dealing) {
    timer = setTimeout(() => {
      dealing = false;
      update();
    }, 780);
  } else if (round.phase === 'redeal') {
    timer = setTimeout(deal, 1150);
  } else if (round.turn !== PLAYER && round.turn !== null) {
    const seat = round.turn;
    timer = setTimeout(() => {
      if (round !== match.round || round.turn !== seat) return;
      const view = seatView(round, seat);
      if (round.phase === 'bidding') bid(match, seat, chooseBid(view, Math.random, difficulty));
      else play(match, seat, choosePlay(view, difficulty));
      update();
    }, 760 + Math.random() * 150);
  }
}

function deal() {
  if (!startRound(match)) return;
  if (ui.tracker.open) ui.tracker.close();
  selected.clear();
  dealing = !reducedMotion.matches;
  update();
}

function takeTurn(cards) {
  if (dealing || !play(match, PLAYER, cards)) return;
  selected.clear();
  update();
}

ui.hand.addEventListener('click', event => {
  const button = event.target.closest('button[data-card]');
  if (!button || button.disabled) return;
  const card = Number(button.dataset.card);
  if (selected.has(card)) selected.delete(card);
  else selected.add(card);
  feedback = '';
  renderSelection();
});

ui.hint.addEventListener('click', () => {
  if (ui.hint.disabled) return;
  hintMoves ??= orderMoves(seatView(match.round, PLAYER));
  if (hintMoves.length) {
    selected.clear();
    hintMoves[hintIndex % hintMoves.length].forEach(card => selected.add(card));
    hintIndex++;
    feedback = '';
  } else {
    feedback = '手里没有能压过的牌，可以选择不出。';
  }
  renderSelection();
});

ui.clear.addEventListener('click', event => {
  selected.clear();
  feedback = '';
  if (event.detail === 0) ui.hand.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  renderSelection();
});

ui.play.addEventListener('click', () => { if (!ui.play.disabled) takeTurn([...selected]); });
ui.pass.addEventListener('click', () => takeTurn([]));
ui.start.addEventListener('click', deal);
ui.next.addEventListener('click', deal);
for (const button of ui.bidButtons) {
  button.addEventListener('click', () => {
    if (!dealing && bid(match, PLAYER, Number(button.dataset.bid))) update();
  });
}

ui.openRules.addEventListener('click', () => ui.rules.showModal());
ui.openTracker.addEventListener('click', () => {
  renderTracker(match.round);
  ui.tracker.showModal();
});
for (const dialog of [ui.rules, ui.tracker]) {
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}
compact.addEventListener?.('change', () => {
  renderHand(match.round?.hands[PLAYER] ?? []);
  renderSelection();
});
for (let rank = 17; rank >= 3; rank--) {
  const cell = element('div');
  const count = element('dd');
  cell.append(element('dt', '', rankLabel(rank)), count);
  ui.trackerCounts.append(cell);
  trackerCells.set(rank, count);
}
configureDifficulty();
update();
