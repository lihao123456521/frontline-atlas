const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(pointerEvents = true) {
  const layers = new Map();
  const bounds = { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 };
  function element(tag = 'g', id = '') {
    const e = { tag, id, attrs: {}, style: { setProperty(k, v) { this[k] = String(v); } },
      children: [], listeners: {}, captures: new Set(), classList: { toggle() {} },
      appendChild(child) { child.parentNode = this; this.children.push(child); },
      insertBefore(child) { this.appendChild(child); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      querySelector() { return layers.get('defs'); },
      getBoundingClientRect() { return bounds; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      setPointerCapture(id) { this.captures.add(id); },
      hasPointerCapture(id) { return this.captures.has(id); },
      releasePointerCapture(id) { this.captures.delete(id); },
      contains(target) { for (let p = target; p; p = p.parentNode) if (p === this) return true; return false; },
      closest(selector) {
        if (selector === '.combat-marker' && this.attrs.class?.split(/\s+/).includes('combat-marker')) return this;
        if (selector.includes('[role="button"]') && this.attrs.role === 'button') return this;
        return this.parentNode?.closest?.(selector) || null;
      }
    };
    Object.defineProperty(e, 'innerHTML', { set() { for (const child of this.children) child.parentNode = null; this.children = []; } });
    return e;
  }
  for (const id of ['defs', 'mapSvg', 'mapWrap', 'layerOcean', 'layerLand', 'layerCountryFills',
    'layerTerritory', 'layerBorders', 'layerSeaLinks', 'layerLabels', 'layerPlanHL', 'layerFronts',
    'layerPlanArrows', 'layerMovePrev', 'layerAttackArrows', 'layerUnits', 'layerBattles', 'layerEffects', 'layerHilight']) {
    layers.set(id, element('g', id));
  }
  const svg = layers.get('mapSvg'), wrap = layers.get('mapWrap');
  wrap.appendChild(svg);
  for (const [id, e] of layers) if (id.startsWith('layer')) svg.appendChild(e);
  const provinces = [{ id: 'home', name: 'Home', x: 500, y: 250, owner: 'ger' },
    { id: 'target', name: 'Target', x: 550, y: 250, owner: 'pol' }]
    .map(p => ({ ...p, originalOwner: p.owner, shapeOwner: p.owner, terrain: 'plain', garrison: [], isCapital: true }));
  const countries = { ger: { id: 'ger', name: 'Germany', color: '#8899aa', capital: 'home' },
    pol: { id: 'pol', name: 'Poland', color: '#9988aa', capital: 'target' } };
  const shape = (id, x) => ({ id, d: `M${x},200L${x + 50},200L${x + 50},300L${x},300Z`,
    rings: [[[x, 200], [x + 50, 200], [x + 50, 300], [x, 300]]] });
  const state = { provinces, countries, player: 'ger', selectedIdx: -1, wars: [], alliances: {}, recentBattles: [] };
  const selected = [], units = [], focused = [], raf = [];
  const window = { listeners: {}, innerWidth: 1000, innerHeight: 600,
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    UI: { focusCombat(id) { focused.push(id); } } };
  if (pointerEvents) window.PointerEvent = function PointerEvent() {};
  let frameTime = 1000;
  const c = vm.createContext({ console, window, performance: { now: () => frameTime }, Date, requestAnimationFrame(fn) { raf.push(fn); },
    document: { getElementById: id => layers.get(id), createElementNS: (_, tag) => element(tag), querySelectorAll: () => [] },
    WORLD_HISTORICAL_MAP: { land: [], shapes: [shape('ger', 475), shape('pol', 525)] }, PROVINCES_DEF: provinces,
    Game: { state, getCombats: () => [], isAtWar: () => true, isAllied: () => false, neighbors: () => [], country: id => countries[id] } });
  const src = fs.readFileSync(path.join(__dirname, '../js/map.js'), 'utf8')
    .replace('return { W,H,', 'return { getCamera:()=>({scale,panX,panY}), W,H,');
  vm.runInContext(src + '\nthis.map=MapView;', c);
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() {
    const a = c.map.getCamera(), k = a.scale * Math.min(bounds.width / 1000, bounds.height / 500);
    return { x: 500 + (this.x - bounds.left - bounds.width / 2 - a.panX) / k,
      y: 250 + (this.y - bounds.top - bounds.height / 2 - a.panY) / k };
  } });
  svg.getScreenCTM = () => ({ inverse() { return {}; } });
  c.map.bind({ provinceClick: idx => selected.push(idx), unitClick: key => units.push(key) });
  c.map.resetView();
  function fire(surface, type, values = {}) {
    const listeners = surface.listeners[type];
    assert.ok(listeners?.length, `${type} must be bound`);
    const event = { type, pointerId: 1, pointerType: 'touch', button: 0, clientX: 500, clientY: 300,
      target: svg, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}, ...values };
    for (const listener of listeners) listener(event);
    return event;
  }
  return { map: c.map, Game: c.Game, window, wrap, svg, layers, selected, units, focused, fire,
    advance(ms) { frameTime += ms; }, runFrame() { const frame = raf.shift(); if (frame) frame(); },
    resize(width, height) { Object.assign(bounds, { width, height, right: bounds.left + width, bottom: bounds.top + height }); } };
}

test('touch taps select once with small finger jitter and capture on the stable map wrapper', () => {
  const c = setup();
  const before = { ...c.map.getCamera() };
  c.fire(c.wrap, 'pointerdown');
  assert.equal(c.wrap.captures.has(1), true);
  c.fire(c.window, 'pointermove', { clientX: 504, clientY: 303 });
  assert.deepEqual({ ...c.map.getCamera() }, before, 'tap jitter must not pan the camera');
  c.fire(c.window, 'pointerup', { clientX: 504, clientY: 303 });
  assert.deepEqual(c.selected, [0]);
  assert.equal(c.wrap.captures.size, 0);
});

test('slow cumulative touch drags pan without selecting a province', () => {
  const c = setup();
  c.fire(c.wrap, 'pointerdown');
  for (const clientX of [503, 506, 509, 512]) c.fire(c.window, 'pointermove', { clientX });
  c.fire(c.window, 'pointerup', { clientX: 512 });
  assert.ok(c.map.getCamera().panX >= 9);
  assert.deepEqual(c.selected, []);
});

test('two-finger pinch zooms around the gesture center and never leaks a province tap', () => {
  const c = setup();
  c.fire(c.wrap, 'pointerdown', { pointerId: 1, clientX: 450 });
  c.fire(c.wrap, 'pointerdown', { pointerId: 2, clientX: 550 });
  c.fire(c.window, 'pointermove', { pointerId: 2, clientX: 650 });
  const camera = c.map.getCamera();
  assert.equal(camera.scale, 2);
  assert.equal(camera.panX, 50, 'the world point under the old center follows the new pinch center');
  c.fire(c.window, 'pointerup', { pointerId: 2, clientX: 650 });
  c.fire(c.window, 'pointerup', { pointerId: 1, clientX: 450 });
  assert.deepEqual(c.selected, []);
  assert.equal(c.wrap.captures.size, 0);
});

test('pointer cancellation and window blur release gestures without leaving stuck dragging', () => {
  for (const type of ['pointercancel', 'lostpointercapture', 'blur']) {
    const c = setup();
    c.fire(c.wrap, 'pointerdown');
    c.fire(type === 'lostpointercapture' ? c.wrap : c.window, type);
    const before = { ...c.map.getCamera() };
    c.fire(c.window, 'pointermove', { clientX: 570 });
    assert.deepEqual({ ...c.map.getCamera() }, before);
    assert.equal(c.wrap.captures.size, 0);
    assert.deepEqual(c.selected, []);
    c.fire(c.wrap, 'pointerdown'); c.fire(c.window, 'pointerup');
    assert.deepEqual(c.selected, [0]);
  }
});

test('PC Pointer Events preserve mouse selection, drag, wheel zoom and map double-click reset', () => {
  const c = setup();
  c.fire(c.wrap, 'pointerdown', { pointerType: 'mouse' });
  c.fire(c.window, 'pointerup', { pointerType: 'mouse' });
  assert.deepEqual(c.selected, [0]);
  c.fire(c.wrap, 'pointerdown', { pointerType: 'mouse' });
  c.fire(c.window, 'pointermove', { pointerType: 'mouse', clientX: 530 });
  c.fire(c.window, 'pointerup', { pointerType: 'mouse', clientX: 530 });
  assert.deepEqual(c.selected, [0]);
  assert.equal(c.map.getCamera().panX, 30);
  c.fire(c.wrap, 'wheel', { deltaY: -100 });
  assert.ok(c.map.getCamera().scale > 1);
  c.fire(c.wrap, 'dblclick');
  assert.equal(c.map.getCamera().scale, 1);
});

test('a tablet tap on an army counter activates its unit action once', () => {
  const c = setup();
  c.Game.state.provinces[0].garrison = [{ type: 'infantry', hp: 100, maxHp: 100 }];
  c.map.render();
  c.fire(c.wrap, 'pointerdown', { clientY: 322 });
  c.fire(c.window, 'pointerup', { clientY: 322 });
  assert.deepEqual(c.units, ['0_all']);
  assert.deepEqual(c.selected, []);
});

test('army counters offer a 44px touch target while PC keeps its exact visible hit box', () => {
  for (const pointerType of ['touch', 'mouse']) {
    const c = setup();
    c.Game.state.provinces[0].garrison = [{ type: 'infantry', hp: 100, maxHp: 100 }];
    c.map.render();
    c.fire(c.wrap, 'pointerdown', { pointerType, clientY: 343 });
    c.fire(c.window, 'pointerup', { pointerType, clientY: 343 });
    assert.deepEqual(c.units, pointerType === 'touch' ? ['0_all'] : []);
  }
});

test('pinch zoom stays within the same bounds as PC zoom controls', () => {
  const c = setup();
  c.fire(c.wrap, 'pointerdown', { pointerId: 1, clientX: 499 });
  c.fire(c.wrap, 'pointerdown', { pointerId: 2, clientX: 501 });
  c.fire(c.window, 'pointermove', { pointerId: 2, clientX: 700 });
  assert.equal(c.map.getCamera().scale, 14);
  c.fire(c.window, 'pointermove', { pointerId: 2, clientX: 499.1 });
  assert.equal(c.map.getCamera().scale, 1);
  c.fire(c.window, 'pointercancel', { pointerId: 2 });
  c.fire(c.window, 'pointerup', { pointerId: 1 });
  assert.deepEqual(c.selected, []);
});

test('a combat marker still activates exactly once when it is rebuilt while the finger is down', () => {
  const c = setup();
  c.Game.getCombats = () => [{ id: 'fight1', to: 1, name: 'Target', phase: 'engagement', progress: 20, playerSide: 'defend', days: 2 }];
  c.map.render();
  const pressed = c.layers.get('layerBattles').children[0];
  const hit = pressed.children.find(child => child.attrs.class === 'combat-marker-hit');
  assert.ok(hit, 'the combat badge must expose a separate finger-sized hit region');
  assert.equal(+hit.attrs.height, 44);
  c.fire(c.wrap, 'pointerdown', { target: pressed.children[0] });
  c.map.render();
  assert.notEqual(c.layers.get('layerBattles').children[0], pressed);
  c.fire(c.window, 'pointerup');
  assert.deepEqual(c.focused, ['fight1']);
  assert.deepEqual(c.selected, []);
  const current = c.layers.get('layerBattles').children[0];
  c.fire(current, 'click', { detail: 1 });
  assert.deepEqual(c.focused, ['fight1'], 'the compatibility click must not focus a second time');
  c.fire(current, 'keydown', { key: 'Enter', detail: 0 });
  assert.deepEqual(c.focused, ['fight1', 'fight1'], 'keyboard activation remains available');
});

test('dragging or cancelling a combat marker never activates it through a later compatibility click', () => {
  for (const cancel of [false, true]) {
    const c = setup();
    c.Game.getCombats = () => [{ id: 'fight1', to: 1, name: 'Target', playerSide: 'defend', days: 2 }];
    c.map.render();
    const pressed = c.layers.get('layerBattles').children[0];
    c.fire(c.wrap, 'pointerdown', { target: pressed });
    if (cancel) c.fire(c.window, 'pointercancel');
    else {
      c.fire(c.window, 'pointermove', { clientX: 530 });
      c.fire(c.window, 'pointerup', { clientX: 530 });
    }
    c.fire(c.layers.get('layerBattles').children[0], 'click', { detail: 1 });
    assert.deepEqual(c.focused, []);
    assert.deepEqual(c.selected, []);
  }
});

test('releasing outside the visible map cannot select a province', () => {
  const c = setup();
  c.fire(c.wrap, 'pointerdown', { clientX: 997 });
  c.fire(c.window, 'pointerup', { clientX: 1003 });
  assert.deepEqual(c.selected, []);
  assert.equal(c.wrap.captures.size, 0);
});

test('map controls are excluded from touch capture, wheel zoom, and double-click reset', () => {
  const c = setup();
  const control = { closest(selector) { return selector.includes('button') ? this : null; } };
  c.map.zoomIn(); const before = { ...c.map.getCamera() };
  c.fire(c.wrap, 'pointerdown', { target: control });
  assert.equal(c.wrap.captures.size, 0);
  c.fire(c.window, 'pointerup', { target: control });
  c.fire(c.wrap, 'wheel', { target: control, deltaY: -100 });
  c.fire(c.wrap, 'dblclick', { target: control });
  assert.deepEqual({ ...c.map.getCamera() }, before);
  assert.deepEqual(c.selected, []);
});

test('PC mouse fallback also distinguishes cumulative dragging from a click', () => {
  const c = setup(false);
  c.fire(c.wrap, 'mousedown');
  for (const clientX of [503, 506, 509, 512]) c.fire(c.window, 'mousemove', { clientX });
  c.fire(c.window, 'mouseup', { clientX: 512 });
  assert.deepEqual(c.selected, []);
  c.fire(c.wrap, 'mousedown'); c.fire(c.window, 'mouseup');
  assert.deepEqual(c.selected, [0]);
});

test('tablet rotation keeps the selected battlefield visible outside the command card', () => {
  const c = setup();
  c.Game.state.provinces[1].y = 100;
  c.Game.state.selectedIdx = 1;
  c.resize(1280, 800); c.fire(c.window, 'resize'); c.map.focusCountry('pol');
  c.layers.set('rightPanel', { classList: { contains: () => false }, getBoundingClientRect() {
    const r = c.wrap.getBoundingClientRect();
    return { left: r.width - 350, right: r.width - 10, top: 18, bottom: 600, width: 340, height: 582 };
  } });
  for (const [width, height] of [[1024, 768], [768, 1024], [1280, 800]]) {
    c.resize(width, height); c.fire(c.window, 'resize');
    assert.equal(c.map.isProvinceInView(1), true, `${width}x${height} must keep the selected battlefield visible`);
  }
});

test('viewport changes preserve the geographical camera center without an active selection', () => {
  const c = setup();
  c.Game.state.provinces[1].y = 100;
  c.map.focusCountry('pol');
  const center = () => {
    const a = c.map.getCamera(), r = c.wrap.getBoundingClientRect(), k = a.scale * Math.min(r.width / 1000, r.height / 500);
    return { x: 500 - a.panX / k, y: 250 - a.panY / k };
  };
  const before = center();
  for (const [width, height] of [[1280, 800], [1024, 768], [768, 1024], [1000, 600]]) {
    c.resize(width, height); c.fire(c.window, 'resize');
    const after = center();
    assert.ok(Math.abs(after.x - before.x) < 1e-8, 'world longitude must remain stable');
    assert.ok(Math.abs(after.y - before.y) < 1e-8, 'world latitude must remain stable');
  }
});

test('tablet rotation cancels a pending camera animation so old frames cannot move the battlefield offscreen', () => {
  const c = setup();
  c.Game.state.provinces[1].y = 100;
  c.Game.state.selectedIdx = 1;
  c.map.focusCountry('ger'); c.map.focusProvince(1, true);
  c.advance(140); c.runFrame();
  c.resize(768, 1024); c.fire(c.window, 'resize');
  assert.equal(c.map.isProvinceInView(1), true);
  const afterRotation = { ...c.map.getCamera() };
  c.advance(300); c.runFrame();
  assert.deepEqual({ ...c.map.getCamera() }, afterRotation, 'a stale focus frame cannot override the rotated camera');
});
