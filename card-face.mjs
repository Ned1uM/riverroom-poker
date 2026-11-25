export const SUIT_SYMBOLS = ['♠', '♥', '♣', '♦'];
export const SUIT_NAMES = ['黑桃', '红桃', '梅花', '方块'];

function printSpan(className, text = '') {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function corner(rank, symbol, opposite = false) {
  const index = printSpan(opposite ? 'card-index card-index--opposite' : 'card-index');
  index.append(
    printSpan('card-rank', rank),
    printSpan('card-suit card-index-suit', symbol),
  );
  return index;
}

export function renderSuitedFace(card, rank, suit) {
  const symbol = `${SUIT_SYMBOLS[suit]}\uFE0E`;
  card.classList.add('card--face');
  card.classList.toggle('card--red', suit === 1 || suit === 3);
  card.setAttribute('aria-label', `${SUIT_NAMES[suit]} ${rank}`);
  const print = printSpan('card-print');
  print.setAttribute('aria-hidden', 'true');
  print.append(
    printSpan('card-suit card-pip', symbol),
    corner(rank, symbol),
    corner(rank, symbol, true),
  );
  card.append(print);
}
