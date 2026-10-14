const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
const load=file=>fs.readFileSync(path.join(root,file),'utf8');
function setup({balanced=true,scenario='sandbox36',map=false}={}){
  const layers=new Map(),bounds={left:0,top:0,right:1280,bottom:800,width:1280,height:800};
  const element=(tag='g',id='')=>{const n={tagName:tag,id,attrs:{},style:{setProperty(k,v){this[k]=String(v);}},children:[],
    appendChild(c){this.children.push(c);c.parentNode=this;},insertBefore(c){this.appendChild(c);},
    setAttribute(k,v){this.attrs[k]=String(v);},querySelector(){return layers.get('defs');},
    getBoundingClientRect(){return bounds;},addEventListener(){},classList:{toggle(){},contains:()=>false}};
    Object.defineProperty(n,'innerHTML',{get:()=>'',set(){this.children=[];}});return n;};
  for(const id of ['defs','mapSvg','mapWrap','layerOcean','layerLand','layerCountryFills','layerTerritory','layerBorders','layerSeaLinks','layerLabels','layerPlanHL','layerFronts','layerPlanArrows','layerMovePrev','layerAttackArrows','layerUnits','layerBattles','layerEffects','layerHilight'])layers.set(id,element(id==='mapSvg'?'svg':'g',id));
  for(const [id,n]of layers)if(id.startsWith('layer'))n.parentNode=layers.get('mapSvg');
  const ctx=vm.createContext({console,performance,Math:Object.create(Math),window:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},
    document:{getElementById:id=>layers.get(id),createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[]}});
  ctx.Math.random=()=>.99;
  const files=['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','data_historical_regions.js','historical_regions.js','history.js','world.js'];
  if(balanced)files.push('strategic_regions.js');
  files.push('campaign.js','order_of_battle.js','game.js');
  for(const file of files)vm.runInContext(load(file),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  if(map)vm.runInContext(load('map.js'),ctx,{filename:'map.js'});
  return {ctx,Game,R:vm.runInContext('HistoricalRegions',ctx),S:balanced?vm.runInContext('StrategicRegions',ctx):null,
    MapView:map?vm.runInContext('MapView',ctx):null};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} / ${b}`);
const units=s=>s.provinces.flatMap(p=>p.garrison).concat(s.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
test('European operations use fewer connected regions while major world countries gain useful scale',()=>{
  const old=setup({balanced:false}),f=setup();
  assert.deepEqual(plain(f.S.beforeCounts),{pol:17,fra:90,ger:43,uk:116});
  assert.deepEqual(plain(f.S.afterCounts),{pol:17,fra:54,ger:30,uk:70});
  assert.equal(f.Game.state.provinces.length,472);assert.equal(old.Game.state.provinces.length,470);
  for(const [id,before,after]of [['usa',10,21],['chn',7,19],['sov',8,22],['jpn',9,17],['can',1,15],['aus',3,15],['bra',2,15]]){
    assert.equal(old.Game.state.provinces.filter(p=>p.originalOwner===id).length,before,id+' old');
    assert.equal(f.Game.state.provinces.filter(p=>p.originalOwner===id).length,after,id+' balanced');
  }
  assert.equal(f.Game.state.provinces.filter(p=>p.id==='neu_india'||p.id.startsWith('india_')).length,15);
  for(const id of old.R.nodes.filter(n=>n.id===n.strategicProvinceId||n.id.includes('_part_')).map(n=>n.id)){
    assert.deepEqual(plain(f.S.members[id]),[id],id+' capital, old major city or independent enclave stays separate');
  }
  const edges=old.R.adjacency;
  for(const [id,list]of Object.entries(f.S.members)){
    const reached=new Set([list[0]]),queue=[list[0]];
    for(let n=0;n<queue.length;n++)for(const e of edges)if(e.length>0&&(e.a===queue[n]||e.b===queue[n])){
      const next=e.a===queue[n]?e.b:e.a;if(list.includes(next)&&!reached.has(next)){reached.add(next);queue.push(next);}
    }
    assert.equal(reached.size,list.length,id+' merges only connected source polygons');
    assert.equal(new Set(list.map(pid=>old.R.nodes.find(n=>n.id===pid).strategicProvinceId)).size,1,id+' keeps source economic grouping');
  }
});
test('every live anchor is clickable and retired administrative interiors select the shared operation node',()=>{
  const f=setup({map:true}),old=setup({balanced:false});
  for(let i=0;i<f.Game.state.provinces.length;i++){
    const anchor=f.MapView.getProvinceAnchor(i);
    assert.equal(f.MapView.provinceUnderPoint(anchor.x,anchor.y),i,f.Game.province(i).id+' visible self click');
  }
  for(const n of old.R.nodes){
    const live=f.S.safeMapping[n.id],idx=f.Game.provinceById(live);
    assert.equal(f.MapView.provinceUnderPoint(n.x,n.y),idx,n.id+' belongs to '+live);
    if(n.id!==live)assert.equal(f.Game.provinceById(n.id),-1,n.id+' has no independent garrison slot');
  }
  assert.equal(f.Game.province(f.Game.provinceById('can_victoria')).coastal,true);
  assert.equal(f.Game.province(f.Game.provinceById('neu_canada')).coastal,false);
  assert.equal(f.Game.province(f.Game.provinceById('neu_australia')).coastal,false);
  assert.equal(f.Game.country('bra').capital,'world_brazil');
});
test('shared geometry preserves actual land frontiers and never joins islands or jumps third countries',()=>{
  const f=setup(),G=f.Game,i=id=>G.provinceById(id);
  for(const [a,b]of [['ger_hamburg','bel_brussels'],['ger_rhine','fra_paris'],['ger_bavaria','fra_alsace'],
    ['can_vancouver','can_victoria'],['aus_melbourne','aus_hobart'],['jpn_osaka','jpn_takamatsu'],['chn_guangzhou','chn_haikou']]){
    assert.ok(i(a)>=0&&i(b)>=0,a+' / '+b);assert.equal(G.neighbors(i(a)).includes(i(b)),false,a+' has no teleport to '+b);
  }
  assert.ok(G.neighbors(i('sov_vladivostok')).length,'new Far East city connects to its mainland');
  assert.ok(G.state.seaAdj[i('aus_hobart')].length,'Tasmania joins the sea network');
  assert.ok(G.state.seaAdj[i('chn_haikou')].length,'Hainan joins the sea network');
  for(const [n,p]of G.state.provinces.entries())assert.ok(G.neighbors(n).length||p.coastal,p.id+' has land or sea access');
});
test('all three real scenarios preserve national military strength, population weight and resources',()=>{
  for(const scenario of ['sandbox36','poland39','barbarossa41']){
    const old=setup({balanced:false,scenario}),f=setup({scenario});
    for(const id of Object.keys(old.Game.state.countries)){
      near(f.Game.country(id).manpowerCap,old.Game.country(id).manpowerCap,scenario+' '+id+' manpower');
      near(f.Game.country(id).initialVictoryWeight,old.Game.country(id).initialVictoryWeight,scenario+' '+id+' control weight');
      const a=f.Game.armyTotals(id),b=old.Game.armyTotals(id);
      near(a.land,b.land,scenario+' '+id+' equivalent divisions');
      near(a.landPersonnel,b.landPersonnel,scenario+' '+id+' actual soldiers');
      assert.equal(a.naval,b.naval,scenario+' '+id+' naval objects');assert.equal(a.air,b.air,scenario+' '+id+' air objects');
      for(const key of ['resource','oil','rare']){
        const total=g=>g.state.provinces.filter(p=>p.originalOwner===id).reduce((sum,p)=>sum+p[key],0);
        near(total(f.Game),total(old.Game),scenario+' '+id+' '+key);
      }
      for(const key of ['equipment','res','oil','rare','pp','civ','mil'])assert.equal(f.Game.country(id)[key],old.Game.country(id)[key],scenario+' '+id+' stock '+key);
      const nominal=g=>g.state.provinces.filter(p=>p.owner===id).flatMap(p=>p.garrison)
        .reduce((sum,d)=>sum+g.unitPersonnel({...d,hp:d.maxHp}),0);
      near(nominal(f.Game),nominal(old.Game),scenario+' '+id+' nominal personnel');
    }
  }
});
test('old contested saves retain province indexes, controller, soldiers, stocks and research; new campaigns restore balanced geometry',()=>{
  const old=setup({balanced:false}),source=old.Game.state.provinces.find(p=>p.id==='fra_1931_02');
  const contested=source||old.Game.state.provinces.find(p=>p.shapeOwner==='fra'&&p.id!==p.strategicProvinceId);
  contested.owner='ger';old.Game.country('fra').equipment=21;old.Game.country('fra').manpower=4.5;
  old.Game.state.research.slots[0]='inf1';old.Game.state.research.progress.inf1=7;
  const before=plain(old.Game.state),f=setup();assert.equal(f.Game.load(JSON.stringify(before)),true);
  const after=plain(f.Game.state);
  assert.equal(after.provinces.length,470);assert.deepEqual(after.provinces.map(p=>p.id),before.provinces.map(p=>p.id));
  assert.equal(after.provinces.find(p=>p.id===contested.id).owner,'ger');
  assert.deepEqual(after.countries,before.countries);assert.deepEqual(after.research,before.research);
  assert.deepEqual(units(after).map(d=>[d.id,d.hp,d.org]).sort(),units(before).map(d=>[d.id,d.hp,d.org]).sort());
  for(let n=0;n<before.provinces.length;n++)for(const key of ['resource','oil','rare','administrativeWeight'])assert.equal(after.provinces[n][key],before.provinces[n][key],before.provinces[n].id+' '+key);
  assert.equal(f.R.nodes.length,266);assert.equal(f.Game.load(f.Game.save()),true,'old map continues to round trip');
  f.Game.init('ger','fas',null,'standard','sandbox36');assert.equal(f.R.nodes.length,171);assert.equal(f.Game.state.provinces.length,472);
  assert.equal(f.Game.load(f.Game.save()),true,'balanced map round trip');assert.equal(f.R.nodes.length,171);
});
test('a continuing administrative campaign retains its legal frontline battle and every in-transit unit',()=>{
  const old=setup({balanced:false,scenario:'poland39'}),G=old.Game;
  const from=G.provinceById('bul_sofia'),to=G.provinceById('rom_bucharest');
  assert.equal(G.doAssault('bul',from,to,0,1),true);
  const battle=G.state.activeCombats[0];battle.phase='engagement';battle.days=7;battle.progress=25;
  const saved=plain(G.state),f=setup();assert.equal(f.Game.load(JSON.stringify(saved)),true);
  const restored=f.Game.state.activeCombats.find(c=>c.id===battle.id);assert.ok(restored);
  for(const key of ['from','to','phase','days','progress'])assert.equal(restored[key],battle[key],key);
  assert.deepEqual(plain(restored.routePath),plain(battle.routePath));
  assert.deepEqual(plain(restored.attackers.map(e=>({from:e.from,owner:e.owner,unit:e.unit}))),
    plain(battle.attackers.map(e=>({from:e.from,owner:e.owner,unit:e.unit}))));
  for(const entry of restored.attackers)assert.deepEqual(plain(entry.routePath),plain(battle.routePath));
  assert.deepEqual(plain(units(f.Game.state).map(d=>[d.id,d.hp,d.org]).sort()),units(saved).map(d=>[d.id,d.hp,d.org]).sort());
  assert.equal(f.Game.state.provinces.length,470);assert.equal(f.R.nodes.length,266);
  assert.equal(f.Game.load(f.Game.save()),true);
});
