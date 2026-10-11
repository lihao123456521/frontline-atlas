const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const asset = fs.readFileSync(path.join(root, 'js/data_historical_map.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(asset + ';this.mapData=HISTORICAL_MAP;', context);
const map = context.mapData;
const project = (lon, lat) => [(lon + 180) / 360 * 1000, (90 - lat) / 180 * 500];
function ringContains(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function contains(id, lon, lat) {
  const [x, y] = project(lon, lat);
  return map.shapes.find(s => s.id === id).rings.reduce((inside, r) => inside !== ringContains(x, y, r), false);
}
test('1936 historical snapshot has every playable European country and explicit source/license', () => {
  assert.equal(map.year, 1936);
  assert.equal(map.license, 'CC BY-NC-SA 4.0');
  assert.match(map.source, /icr\.ethz\.ch\/data\/cshapes/);
  assert.match(map.sourceSha256, /^[0-9a-f]{64}$/);
  for (const id of ['ger','sov','uk','fra','ita','pol','nld','swe','yug','grc','tur','esp','prt','bel','lux','nor','fin','dnk','irl','aut','che','cze','hun','rom','bul','alb','est','lva','ltu']) {
    assert.ok(map.shapes.some(s => s.id === id), id);
  }
});
test('historical political geography includes East Prussia, Polish Lwow and independent Austria/Ireland', () => {
  assert.ok(contains('ger', 20.51, 54.71));
  assert.ok(contains('pol', 24.03, 49.84));
  assert.ok(contains('aut', 16.37, 48.21));
  assert.equal(contains('ger', 16.37, 48.21), false);
  assert.ok(contains('irl', -6.26, 53.35));
  assert.equal(contains('uk', -6.26, 53.35), false);
  assert.ok(contains('cze', 14.42, 50.08));
});
test('detailed country rings are nondegenerate, bounded and retain islands', () => {
  for (const shape of map.shapes) {
    assert.ok(shape.rings.length);
    for (const ring of shape.rings) {
      assert.ok(ring.length >= 3, shape.id);
      assert.ok(ring.every(p => p.length === 2 && p.every(Number.isFinite)), shape.id);
    }
  }
  assert.ok(map.shapes.find(s => s.id === 'ger').rings.flat().length > 400);
  assert.ok(map.shapes.find(s => s.id === 'che').rings.flat().length > 100);
  assert.ok(map.shapes.find(s => s.id === 'uk').rings.length > 5);
  assert.ok(map.land.length > 100);
});
test('shared historical borders connect Germany/Poland but do not create an English Channel land link', () => {
  const pair = (a, b) => map.adjacency.some(p => p.includes(a) && p.includes(b));
  assert.ok(pair('ger', 'pol'));
  assert.ok(pair('ger', 'cze'));
  assert.ok(pair('bel', 'fra'));
  assert.equal(pair('uk', 'fra'), false);
});

function makeRenderer() {
  const elements = new Map();
  function element() {
    const el = { children: [], attrs: {}, style: {}, classList: { toggle() {} },
      appendChild(child) { this.children.push(child); },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      querySelector() { return elements.get('defs'); } };
    Object.defineProperty(el,'innerHTML',{get(){return '';},set(){this.children=[];}});
    return el;
  }
  for (const id of ['defs','mapSvg','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight']) elements.set(id, element());
  const definitions = [
    { id:'berlin',owner:'ger',lon:13.4,lat:52.5 },
    { id:'rhine',owner:'ger',lon:7.2,lat:50.2 },
    { id:'warsaw',owner:'pol',lon:21,lat:52.2 },
  ];
  const provinces = definitions.map(d => {
    const [x,y] = project(d.lon,d.lat);
    return {...d,x,y,originalOwner:d.owner,garrison:[]};
  });
  const c = vm.createContext({
    document:{getElementById:id=>elements.get(id),createElementNS:()=>element(),querySelectorAll:()=>[]},
    layers:elements,
    PROVINCES_DEF:definitions,
    Game:{state:{provinces,countries:{ger:{color:'#4a69bd'},pol:{color:'#c96a4a'}},player:'ger'}},
  });
  const rendererSource=fs.readFileSync(path.join(root,'js/map.js'),'utf8').replace('return { W,H,','return { renderLand,renderCountryShapes,renderTerritory,renderBorders, W,H,');
  vm.runInContext(asset + '\n' + rendererSource + ';this.renderer=MapView;',c);
  return c;
}
test('click region covers the full historical country and excludes water', () => {
  const c = makeRenderer();
  const [x,y] = project(10,50);
  assert.ok(c.renderer.provinceUnderPoint(x,y) >= 0);
  const [seaX,seaY] = project(-3,47);
  assert.equal(c.renderer.provinceUnderPoint(seaX,seaY), -1);
});
test('scenario occupation cannot move Poland geometry into Germany, and new state invalidates cells', () => {
  const c = makeRenderer();
  const [x,y] = project(21,52.2);
  c.Game.state.provinces[2].owner='ger';
  c.Game.state.provinces[2].originalOwner='ger';
  assert.equal(c.renderer.provinceUnderPoint(x,y),2);
  c.Game.state.provinces = c.Game.state.provinces.slice(2);
  assert.equal(c.renderer.provinceUnderPoint(x,y),0);
});
test('start screen defers coastline DOM; idle rendering keeps historical layers and conquest updates them', () => {
  const c=makeRenderer(), r=c.renderer;
  assert.equal(c.layers.get('layerLand').children.length,0);
  r.renderLand();r.renderCountryShapes();r.renderBorders();r.renderTerritory();
  const coast=c.layers.get('layerLand').children[0];
  const border=c.layers.get('layerBorders').children[0];
  const fill=c.layers.get('layerCountryFills').children[0];
  const control=c.layers.get('layerTerritory').children[0];
  r.renderLand();r.renderCountryShapes();r.renderBorders();r.renderTerritory();
  assert.equal(c.layers.get('layerLand').children[0],coast);
  assert.equal(c.layers.get('layerBorders').children[0],border);
  assert.equal(c.layers.get('layerCountryFills').children[0],fill);
  assert.equal(c.layers.get('layerTerritory').children[0],control);
  c.Game.state.provinces[2].owner='ger';
  r.renderCountryShapes();r.renderTerritory();
  assert.notEqual(c.layers.get('layerCountryFills').children[0],fill);
  assert.notEqual(c.layers.get('layerTerritory').children[0],control);
});
