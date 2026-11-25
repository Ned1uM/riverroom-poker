const TIMINGS = {
  deal: { spacing: 125, travel: 435, flip: 245 },
  board: { spacing: 130, travel: 390, flip: 275 },
  showdown: { spacing: 120, travel: 0, flip: 310 },
};

const EASE_OUT = 'cubic-bezier(.18,.72,.28,1)';

function travelFrames(origin, destination, settle, index) {
  const dx = origin.x - destination.x;
  const dy = origin.y - destination.y;
  const lift = Math.min(45, Math.hypot(dx, dy) * .18);
  const swing = index % 2 ? 9 : -9;
  const scale = Math.min(1, origin.width / destination.width);
  return [
    { transform: `translate(${dx}px, ${dy}px) rotate(-12deg) scale(${scale})`, opacity: 0 },
    { transform: `translate(${dx * .78}px, ${dy * .78 - lift * .6}px) rotate(${swing * 1.8}deg) scale(${(1 + scale) / 2})`, opacity: 1, offset: .28 },
    { transform: `translate(${dx * .13}px, ${dy * .13 - lift * .27}px) rotate(${swing}deg)`, opacity: 1, offset: .79 },
    { transform: settle, opacity: 1 },
  ];
}

function animateCard(layer, origin, item, index, timing, back) {
  const { node, previousTransform } = item;
  const layerBounds = layer.getBoundingClientRect();
  const pocketBounds = node.parentElement.getBoundingClientRect();
  const tone = getComputedStyle(node);
  const width = parseFloat(tone.width);
  const height = parseFloat(tone.height);
  const x = pocketBounds.left - layerBounds.left + node.offsetLeft;
  const y = pocketBounds.top - layerBounds.top + node.offsetTop;

  const flight = document.createElement('div');
  flight.className = 'card-flight';
  Object.assign(flight.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  flight.style.setProperty('--flight-width', `${width}px`);
  flight.style.setProperty('--flight-radius', tone.borderRadius);

  const sides = document.createElement('div');
  sides.className = 'card-flight-sides';
  sides.append(back.cloneNode(true));
  const faceUp = node.classList.contains('card--face');
  if (faceUp) {
    const front = node.cloneNode(true);
    front.classList.add('card-flight-front');
    sides.append(front);
  }
  flight.append(sides);
  layer.append(flight);
  node.classList.add('is-in-flight');

  const delay = timing.spacing * index;
  const finishPosition = tone.transform;
  const tracks = [];
  if (timing.travel) {
    const destination = { x: x + width / 2, y: y + height / 2, width };
    tracks.push(flight.animate(travelFrames(origin, destination, finishPosition, index), {
      delay, duration: timing.travel, fill: 'both', easing: EASE_OUT,
    }));
  } else {
    tracks.push(flight.animate([{ transform: previousTransform }, { transform: finishPosition }], {
      delay, duration: timing.flip, fill: 'both', easing: EASE_OUT,
    }));
  }
  if (faceUp) {
    tracks.push(sides.animate([
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(-180deg)' },
    ], { delay: delay + timing.travel, duration: timing.flip, fill: 'both', easing: 'ease-in-out' }));
  }

  let cleaned = false;
  function cleanUp() {
    if (cleaned) return;
    cleaned = true;
    flight.remove();
    node.classList.remove('is-in-flight');
  }
  return {
    finished: Promise.allSettled(tracks.map(track => track.finished)).then(cleanUp),
    cancel() {
      for (const track of tracks) track.cancel();
      cleanUp();
    },
  };
}

export function animateCards(table, deck, layer, cue, opening) {
  const deckBounds = deck.getBoundingClientRect();
  const layerBounds = layer.getBoundingClientRect();
  const origin = {
    x: deckBounds.left + deckBounds.width / 2 - layerBounds.left,
    y: deckBounds.top + deckBounds.height / 2 - layerBounds.top,
    width: deck.offsetWidth,
  };
  table.classList.toggle('is-opening', opening);
  const timing = cue.kind === 'deal' && cue.cards.length > 4 ? { ...TIMINGS.deal, spacing: 85 } : TIMINGS[cue.kind];
  const clips = cue.cards.map((card, index) => animateCard(layer, origin, card, index, timing, deck.firstElementChild));
  let cleaned = false;
  function cleanUp() {
    if (cleaned) return;
    cleaned = true;
    table.classList.remove('is-opening');
  }
  return {
    finished: Promise.all(clips.map(clip => clip.finished)).then(cleanUp),
    cancel() {
      for (const clip of clips) clip.cancel();
      cleanUp();
    },
  };
}
