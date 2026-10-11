const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
  const layers=new Map(), bounds={left:0,top:0,right:1000,bottom:600,width:1000,height:600};
  function element(tag='g',id=''){
    const e={tag,id,attrs:{},dataset:{},style:{setProperty(k,v){this[k]=String(v);}},children:[],listeners:{},classList:{toggle(){}},appendChild(c){this.children.push(c);},insertBefore(c){this.children.push(c);},setAttribute(k,v){this.attrs[k]=String(v);},querySelector(){return layers.get('defs');},querySelectorAll(){return [];},getBoundingClientRect(){return bounds;},addEventListener(type,fn){this.listeners[type]=fn;}};
    Object.defineProperty(e,'innerHTML',{set(){this.children=[];}});return e;
  }
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element('g',id));
  layers.get('mapSvg').createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});
  layers.get('mapSvg').getScreenCTM=()=>({inverse(){return{};}});
  for(const [id,e]of layers)if(id.startsWith('layer'))e.parentNode=layers.get('mapSvg');
  const provinces=[['a','ger',500,150],['b','pol',535,155],['c','fra',460,180],['d','ita',505,200],['e','jpn',995,220],['f','usa',5,220]].map(([id,owner,x,y])=>({id,name:id,owner,originalOwner:owner,shapeOwner:owner,x,y,terrain:'plain',garrison:[{type:'infantry',hp:100,maxHp:100}],isCapital:true}));
  const countries=Object.fromEntries(provinces.map(p=>[p.owner,{id:p.owner,name:p.owner,color:'#8099a1',capital:p.id}]));
  const state={provinces,countries,player:'ger',selectedIdx:0,adj:[[1,2,3],[0],[0],[0],[5],[4]],seaAdj:provinces.map(()=>[]),wars:[],alliances:{},buildQueue:[],battles:0};
  let time=1000;const rafQueue=[];
  const ctx=vm.createContext({console,document:{getElementById:id=>layers.get(id),createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[]},window:{listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}},WORLD_HISTORICAL_MAP:{land:[],shapes:[]},PROVINCES_DEF:provinces,Game:{state,isAtWar:(a,b)=>a!==b,isAllied:(a,b)=>[a,b].sort().join(',')==='ger,ita',neighbors:i=>state.adj[i],country:id=>countries[id],unitPersonnel:d=>Math.round((d.people||10000)*d.hp/d.maxHp),personnelOf:units=>units.reduce((n,d)=>n+Math.round((d.people||10000)*d.hp/d.maxHp),0),provincePersonnel:i=>state.provinces[i].garrison.reduce((n,d)=>n+Math.round((d.people||10000)*d.hp/d.maxHp),0)},UNIT_SHORT:{infantry:'步'},Date:{now:()=>time},requestAnimationFrame(fn){rafQueue.push(fn);},layers});
  let src=fs.readFileSync(path.join(__dirname,'../js/map.js'),'utf8');
  src=src.replace('return { W,H,','return { getK:()=>visibleAnchor().k,highlightSeaLinks, W,H,');
  vm.runInContext(src+'\nthis.map=MapView;',ctx);
  ctx.advance=ms=>{time+=ms;};ctx.runFrame=()=>{const frame=rafQueue.shift();if(frame)frame();return !!frame;};ctx.pendingFrames=()=>rafQueue.length;return ctx;
}
function all(e){return [e,...e.children.flatMap(all)];}
function marks(c,id){return c.layers.get(id).children;}
function noLines(c,ids){for(const id of ids)assert.equal(all(c.layers.get(id)).filter(e=>e.tag==='line'||e.tag==='polygon').length,0,id);}
test('multiple wartime neighbors never create front, candidate, plan or hover connecting lines',()=>{
  const c=setup();c.map.render();c.map.showAttackable(0);c.map.setHover(1);c.map.render();
  noLines(c,['layerFronts','layerPlanArrows','layerPlanHL','layerHilight']);
  const candidates=marks(c,'layerPlanHL').filter(e=>e.attrs.class?.includes('order-candidate'));
  assert.equal(candidates.length,2,'allied province is excluded');
  c.map.showBattlePlan({attacks:[{from:0,to:1},{from:2,to:1}]});
  noLines(c,['layerPlanArrows','layerPlanHL']);
  assert.equal(marks(c,'layerPlanHL').filter(e=>e.attrs.class?.includes('order-origin')).length,2);
  assert.equal(marks(c,'layerPlanHL').filter(e=>e.attrs.class?.includes('order-target')).length,1);
  c.map.clearBattlePlan();c.map.render();assert.equal(marks(c,'layerPlanHL').length,0);
});
test('order markers keep their screen size after zoom and move previews only show endpoints',()=>{
  const c=setup();c.map.showBattlePlan({attacks:[{from:0,to:1}]});
  const before=marks(c,'layerPlanHL')[0];
  assert.match(before.attrs.transform,/scale\(1\)/);
  c.map.zoomIn();
  const after=marks(c,'layerPlanHL')[0];
  assert.ok(after.attrs.transform.endsWith(`scale(${1/c.map.getK()})`));
  assert.equal(before.children[0].attrs.r,after.children[0].attrs.r);
  c.map.showMovePreview([0,2,4,5]);
  assert.equal(marks(c,'layerMovePrev').length,2);noLines(c,['layerMovePrev']);
  c.map.zoomIn();assert.ok(marks(c,'layerMovePrev')[0].attrs.transform.endsWith(`scale(${1/c.map.getK()})`));
  c.map.clearMovePreview();c.map.clearAttackable();c.map.render();
  assert.equal(marks(c,'layerMovePrev').length,0);assert.equal(marks(c,'layerPlanHL').length,0);
});
test('battle feedback is local, bounded, player-only and expires without route lines across the date line',()=>{
  const c=setup();c.map.playAttack(4,5,true,'usa');c.map.render();assert.equal(marks(c,'layerBattles').length,0);
  c.Game.state.player='jpn';c.map.playAttack(4,5,true,'usa');c.map.render();
  const badge=marks(c,'layerBattles')[0];assert.ok(badge.attrs.transform.startsWith('translate(5,220)'));
  noLines(c,['layerBattles','layerAttackArrows']);
  c.map.addCaptureFlash(5);c.map.render();assert.equal(marks(c,'layerBattles').length,1);
  c.map.playAttack(4,0,false,'ger');c.map.playAttack(4,1,true,'pol');c.map.playAttack(4,2,true,'fra');c.map.render();
  assert.ok(marks(c,'layerBattles').length<=2);
  c.advance(2000);c.map.render();assert.equal(marks(c,'layerBattles').length,0);assert.equal(c.map.isAnimating(),false);
});
test('port hover and selection never reveal sea route lines or change landing adjacency',()=>{
  const c=setup();c.Game.state.seaAdj[0]=[1,2,3,4,5];
  const before=JSON.stringify(c.Game.state.seaAdj);
  c.map.render();c.map.highlightSeaLinks(0);c.map.setHover(0);c.map.render();
  c.map.setSelect(0);c.map.showMovePreview([0,5]);
  noLines(c,['layerSeaLinks','layerMovePrev']);
  assert.equal(marks(c,'layerSeaLinks').length,0);
  assert.equal(JSON.stringify(c.Game.state.seaAdj),before);
});
test('every camera scale update exposes the CSS compensation zoom from 1 to 14',()=>{
  const c=setup(),style=c.layers.get('mapSvg').style;
  const current=()=>{
    assert.equal(+style['--map-zoom'],c.map.getK());
    assert.ok(style.transform.endsWith(`scale(${style['--map-zoom']})`));
  };
  c.map.resetView();current();assert.equal(style['--map-zoom'],'1');
  for(let i=0;i<30;i++){c.map.zoomIn();current();}
  assert.equal(style['--map-zoom'],'14');
  c.map.focusCountry('ger');current();c.map.focusRegion('pacific');current();
  c.map.zoomOut();current();c.map.resetView();current();assert.equal(style['--map-zoom'],'1');
});

test('ongoing combat stays as one clickable local badge after transient feedback expires',()=>{
  const c=setup();let focused=null;
  c.window.UI={focusCombat:id=>{focused=id;}};
  c.Game.getCombats=()=>[{id:'fight1',to:1,name:'b',days:4,progress:35,phase:'engagement',playerSide:'attack',aPersonnel:32000,dPersonnel:18000}];
  c.map.render();const badge=marks(c,'layerBattles')[0];
  assert.equal(badge.attrs.role,'button');assert.match(badge.attrs['aria-label'],/4天/);
  assert.match(all(badge).map(e=>e.textContent||'').join(' '),/攻城 35%/);
  assert.match(badge.attrs['aria-label'],/攻 3\.2万 \/ 守 1\.8万/);
  let stopped=false;badge.listeners.click({stopPropagation(){stopped=true;}});
  assert.equal(focused,'fight1');assert.equal(stopped,true);
  c.advance(5000);c.map.zoomIn();c.map.render();
  assert.equal(marks(c,'layerBattles').length,1);
  assert.ok(marks(c,'layerBattles')[0].attrs.transform.endsWith(`scale(${1/c.map.getK()})`));
  noLines(c,['layerBattles','layerAttackArrows','layerFronts']);
  c.Game.getCombats=()=>[];c.map.render();assert.equal(marks(c,'layerBattles').length,0);
});

test('map counters use people instead of division counts and latest results persist with current ownership',()=>{
  const c=setup(),province=c.Game.state.provinces[0];
  province.garrison=[{type:'infantry',hp:100,maxHp:100,people:12000},{type:'infantry',hp:50,maxHp:100,people:12000}];
  c.Game.state.recentBattles=[
    {attacker:'ger',defender:'pol',to:1,name:'b',date:'1939.1.2',won:true},
    {attacker:'fra',defender:'ger',to:2,name:'c',date:'1939.1.1',won:false},
    {attacker:'ger',defender:'ita',to:3,name:'d',date:'1938.12.30',won:true},
  ];
  c.Game.state.provinces[1].owner='ger';
  c.map.resetView();
  assert.ok(marks(c,'layerUnits').some(e=>all(e).some(n=>(n.textContent||'').includes('2.8万'))));
  let results=marks(c,'layerBattles').filter(e=>e.attrs.class?.includes('battle-result'));
  assert.equal(results.length,2,'only the latest two distinct provinces are marked');
  assert.ok(all(c.layers.get('layerBattles')).some(e=>(e.textContent||'').includes('已占领 · ger')));
  c.advance(120000);c.map.render();
  assert.equal(marks(c,'layerBattles').filter(e=>e.attrs.class?.includes('battle-result')).length,2,'saved results outlive the brief animation');
  c.map.playAttack(0,1,true,'pol');
  for(let frame=1;frame<=4;frame++){
    assert.equal(c.runFrame(),true,`animation frame ${frame} was scheduled`);
    assert.equal(marks(c,'layerBattles').filter(e=>e.attrs.class?.includes('battle-result')).length,2,`persistent battle labels remain visible on animation frame ${frame}`);
  }
  c.Game.state.provinces[1].owner='pol';c.map.render();
  assert.ok(all(c.layers.get('layerBattles')).some(e=>(e.textContent||'').includes('已失守 · pol')),'a winning attack later retaken by the original defender is still reported as lost');
  c.Game.state.provinces[1].owner='fra';c.map.render();
  assert.ok(all(c.layers.get('layerBattles')).some(e=>(e.textContent||'').includes('已失守 · fra')),'a later occupation replaces the stale capture label');
});

test('combat badge mouse press never enters map drag or province selection before its click',()=>{
  const c=setup();let selected=0,focused=null;
  c.window.UI={focusCombat:id=>{focused=id;}};
  c.Game.getCombats=()=>[{id:'fight1',to:1,name:'b',days:4,progress:35,playerSide:'attack'}];
  c.map.bind({provinceClick(){selected++;}});c.map.render();
  const badge=marks(c,'layerBattles')[0];
  const event={button:0,clientX:535,clientY:155,target:{closest(selector){return selector.includes('[role="button"]')?badge:null;}},stopPropagation(){}};
  c.layers.get('mapWrap').listeners.mousedown(event);
  c.window.listeners.mouseup(event);
  assert.equal(selected,0,'mouseup must not select a province or rebuild the pressed badge');
  badge.listeners.click(event);assert.equal(focused,'fight1');
});
