const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(legacy=false){
  const layers=new Map();
  function element(){
    const node={children:[],attrs:{},style:{setProperty(){}},appendChild(child){this.children.push(child);},
      setAttribute(key,value){this.attrs[key]=String(value);},querySelector(){return layers.get('defs');},
      getBoundingClientRect(){return {left:0,top:0,width:1000,height:600,right:1000,bottom:600};},addEventListener(){}};
    Object.defineProperty(node,'innerHTML',{set(){this.children=[];}});return node;
  }
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element());
  const square=(left,top,size)=>[[left,top],[left+size,top],[left+size,top+size],[left,top+size]];
  const ringPath=ring=>'M'+ring.map(point=>point.join(',')).join('L')+'Z';
  const shapes=[{id:'home',rings:[square(0,0,100)]},{id:'foreign',rings:[square(100,0,100),square(150,150,20)]}]
    .map(shape=>({...shape,d:shape.rings.map(ringPath).join(' ')}));
  const definitions=[{id:'capital',owner:'home',x:20,y:50},{id:'border',owner:'home',x:80,y:50},
    {id:'occupied',owner:'foreign',x:130,y:50},{id:'opponent',owner:'foreign',x:180,y:50},
    {id:'island',owner:'foreign',x:160,y:160}];
  if(legacy){
    for(const shape of shapes){shape.rings=shape.rings.map(ring=>ring.map(([x,y])=>[x+440,y]));shape.d=shape.rings.map(ringPath).join(' ');}
    for(const province of definitions)province.x+=440;
  }
  const provinces=definitions.map((province,index)=>({...province,shapeOwner:province.owner,originalOwner:province.owner,
    owner:index===3?'enemy':'player',name:province.id,garrison:[],terrain:index===2?'mountain':'plain'}));
  const state={provinces,player:'player',selectedIdx:0,countries:{player:{id:'player',name:'Player',color:'#305ca8'},
    enemy:{id:'enemy',name:'Enemy',color:'#d58a38'}},wars:[['player','enemy']],alliances:{},
    buildQueue:[],battles:0,activeCombats:[{id:'advance',from:2,to:3,attacker:'player',defender:'enemy',phase:'engagement',progress:35}]};
  const context=vm.createContext({document:{getElementById:id=>layers.get(id),createElementNS:()=>element(),querySelectorAll:()=>[]},
    window:{},performance,PROVINCES_DEF:definitions,
    ...(legacy?{WORLD_PATHS:[],PROVINCE_POLYS:shapes,ISO_TO_GAME:{home:'home',foreign:'foreign'}}:{HISTORICAL_MAP:{land:[],shapes}}),
    TERRAIN:{plain:{color:'#aabbcc'},mountain:{color:'#ff00aa'}},
    Game:{state,isAtWar:(first,second)=>first!==second,isAllied:()=>false,neighbors:()=>[]}});
  const source=fs.readFileSync(path.join(__dirname,'../js/map.js'),'utf8')
    .replace('return { W,H,','return { renderCountryShapes,renderTerritory,renderFronts,renderHilight, W,H,');
  vm.runInContext(source+'\nthis.map=MapView;',context);
  return {map:context.map,state,layers};
}

test('political geography backings and controlled mainland or islands use the exact current country color',()=>{
  const context=setup();context.map.renderCountryShapes();context.map.renderTerritory();
  const backings=context.layers.get('layerCountryFills').children;
  assert.ok(backings.every(node=>node.attrs.fill==='#305ca8'),'historical majority backing must not desaturate the country color');
  for(const index of [0,1,2,4]){
    const node=context.layers.get('layerTerritory').children[index];
    assert.equal(node.attrs.fill,'#305ca8',context.state.provinces[index].id);
    assert.equal(node.attrs.opacity,'1');
    const province=context.state.provinces[index];
    assert.equal(context.map.provinceUnderPoint(province.x,province.y),index);
  }
});

test('legacy geographic backings do not reintroduce translucent control or a country-dependent sheen',()=>{
  const context=setup(true);context.map.renderCountryShapes();context.map.renderTerritory();
  const backings=context.layers.get('layerCountryFills').children;
  assert.ok(backings.length>=2);assert.ok(backings.every(node=>node.attrs.fill==='#305ca8'));
  assert.ok(context.layers.get('layerTerritory').children.every(node=>node.attrs.opacity==='1'));
});

test('selection and hover outline land without tinting the controlled country',()=>{
  const context=setup();context.map.setHover(2);context.map.renderTerritory();context.map.renderHilight();
  for(const kind of ['historical-cell-selected','historical-cell-hover']){
    const node=context.layers.get('layerHilight').children.find(child=>child.attrs.class===kind);
    assert.ok(node,kind);assert.equal(node.attrs.fill,'none');
  }
});

test('political battle progress adds a directional local gradient without changing controlled land or ownership',()=>{
  const context=setup();context.map.renderTerritory();context.map.renderFronts();
  const before=context.layers.get('layerFronts').children[0];
  assert.match(before.children.find(child=>child.attrs.class==='combat-front-fill').attrs.fill,/^url\(#combat-progress-/);
  assert.equal(context.layers.get('layerTerritory').children[3].attrs.fill,'#d58a38');
  assert.equal(context.layers.get('layerTerritory').children[3].attrs.opacity,'1');
  const beforeBoundary=before.children.find(child=>child.attrs.class==='combat-front-line').attrs.d;
  context.state.activeCombats[0].progress=65;context.map.renderFronts();
  const after=context.layers.get('layerFronts').children[0];
  assert.notEqual(after.children.find(child=>child.attrs.class==='combat-front-line').attrs.d,beforeBoundary);
  assert.equal(context.state.provinces[3].owner,'enemy');
});

test('political rendering disables screen-position tint while terrain and diplomacy retain their distinct rules',()=>{
  const context=setup();context.map.render();
  assert.equal(context.layers.get('mapSvg').attrs['data-map-mode'],'political');
  assert.equal(context.layers.get('mapWrap').attrs['data-map-mode'],'political');
  const css=fs.readFileSync(path.join(__dirname,'../css/map-fronts.css'),'utf8');
  assert.match(css,/#mapWrap\[data-map-mode=["']political["']\]::after\s*\{[^}]*background\s*:\s*none/);
  assert.match(css,/#mapSvg\[data-map-mode=["']political["']\] #layerTerritory\s*\{[^}]*filter\s*:\s*none/);
  assert.match(css,/#mapSvg\[data-map-mode=["']political["']\] \.historical-cell-selected[^}]*fill\s*:\s*none/);
  assert.match(css,/#mapSvg\[data-map-mode=["']political["']\] \.historical-cell-hover[^}]*fill\s*:\s*none/);
  context.map.setMapMode('terrain');
  assert.equal(context.layers.get('mapWrap').attrs['data-map-mode'],'terrain');
  assert.equal(context.layers.get('layerTerritory').children[2].attrs.fill,'#ff00aa');
  assert.equal(context.layers.get('layerTerritory').children[2].attrs.opacity,'0.62');
  assert.match(context.layers.get('layerFronts').children[0].children.find(child=>child.attrs.class==='combat-front-fill').attrs.fill,/^url\(#combat-progress-/);
  context.map.setMapMode('diplomatic');
  assert.equal(context.layers.get('layerTerritory').children[2].attrs.fill,'#3f8fd6');
  assert.equal(context.layers.get('layerTerritory').children[3].attrs.fill,'#8a2020');
  context.map.setMapMode('political');
  assert.match(context.layers.get('layerFronts').children[0].children.find(child=>child.attrs.class==='combat-front-fill').attrs.fill,/^url\(#combat-progress-/);
});
