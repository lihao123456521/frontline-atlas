const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../js');
const load=file=>fs.readFileSync(path.join(root,file),'utf8');
function setup({balanced=true,scenario='sandbox36',map=false,mapVersion}={}){
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
  if(['v1','v2','v3'].includes(mapVersion))vm.runInContext(`{
    const select=StrategicRegions.useBalanced,apply=StrategicRegions.apply;
    const version=${mapVersion==='v1'?'StrategicRegions.previousVersion':mapVersion==='v2'?'StrategicRegions.compactVersion':'StrategicRegions.groupedVersion'};
    StrategicRegions.useBalanced=()=>select(version);
    StrategicRegions.apply=s=>{apply(s);select(version);s.strategicRegionsVersion=version;};
  }`,ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard',scenario);
  if(map)vm.runInContext(load('map.js'),ctx,{filename:'map.js'});
  return {ctx,Game,R:vm.runInContext('HistoricalRegions',ctx),S:balanced?vm.runInContext('StrategicRegions',ctx):null,
    MapView:map?vm.runInContext('MapView',ctx):null,layers};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} / ${b}`);
const units=s=>s.provinces.flatMap(p=>p.garrison).concat(s.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));
test('European operations use fewer connected regions while major world countries gain useful scale',()=>{
  const old=setup({balanced:false}),f=setup();
  assert.deepEqual(plain(f.S.beforeCounts),{pol:17,fra:90,ger:43,uk:116});
  assert.deepEqual(plain(f.S.previousCounts),{pol:17,fra:54,ger:30,uk:70});
  assert.deepEqual(plain(f.S.compactCounts),{pol:17,fra:54,ger:19,uk:65});
  assert.deepEqual(plain(f.S.afterCounts),{pol:15,fra:45,ger:12,uk:39});
  assert.equal(f.Game.state.provinces.length,418);assert.equal(old.Game.state.provinces.length,470);
  assert.equal(f.S.compactRegionMerges.length,29);
  for(const [id,before,after]of [['usa',10,21],['chn',7,19],['sov',8,22],['jpn',9,17],['can',1,15],['aus',3,15],['bra',2,15]]){
    assert.equal(old.Game.state.provinces.filter(p=>p.originalOwner===id).length,before,id+' old');
    assert.equal(f.Game.state.provinces.filter(p=>p.originalOwner===id).length,after,id+' balanced');
  }
  assert.equal(f.Game.state.provinces.filter(p=>p.id==='neu_india'||p.id.startsWith('india_')).length,15);
  for(const id of old.R.nodes.filter(n=>n.id===n.strategicProvinceId).map(n=>n.id)){
    assert.ok(f.S.members[id].includes(id),id+' capital or major city keeps its identity');
  }
  for(const n of old.R.nodes.filter(n=>!old.R.adjacency.some(e=>e.a===n.id||e.b===n.id))){
    assert.deepEqual(plain(f.S.members[n.id]),[n.id],n.id+' separate island remains separate');
  }
  const edges=old.R.adjacency;
  for(const [id,list]of Object.entries(f.S.members)){
    const reached=new Set([list[0]]),queue=[list[0]];
    for(let n=0;n<queue.length;n++)for(const e of edges)if(e.length>0&&(e.a===queue[n]||e.b===queue[n])){
      const next=e.a===queue[n]?e.b:e.a;if(list.includes(next)&&!reached.has(next)){reached.add(next);queue.push(next);}
    }
    assert.equal(reached.size,list.length,id+' merges only connected source polygons');
    assert.equal(new Set(list.map(pid=>old.R.nodes.find(n=>n.id===pid).shapeOwner)).size,1,id+' never crosses a national boundary');
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
  f.Game.init('ger','fas',null,'standard','sandbox36');assert.equal(f.R.nodes.length,111);assert.equal(f.Game.state.provinces.length,418);
  assert.equal(f.Game.load(f.Game.save()),true,'balanced map round trip');assert.equal(f.R.nodes.length,111);
});

test('v1 balanced saves preserve retired small regions and disputed control while new campaigns choose v4',()=>{
  const old=setup({mapVersion:'v1',scenario:'poland39'}),G=old.Game;
  assert.equal(G.state.provinces.length,478);assert.equal(old.R.nodes.length,171);
  assert.equal(G.state.strategicRegionsVersion,'strategic-balanced-1');
  const small=G.state.provinces.find(p=>p.id==='ger_regis_130_1_430_part_1');
  assert.ok(small);small.owner='fra';small.garrison=[G.makeDivision('infantry')];small.garrison[0].owner='fra';
  small.garrison[0].hp=28;small.garrison[0].org=31.25;
  G.country('fra').equipment=21;G.state.research.progress.inf1=7;
  const saved=plain(G.state),f=setup({map:true});assert.equal(f.Game.load(JSON.stringify(saved)),true);
  const after=plain(f.Game.state);assert.equal(after.provinces.length,478);assert.equal(f.R.nodes.length,171);
  assert.equal(f.R.version,'strategic-balanced-1');
  assert.deepEqual(after.provinces,saved.provinces,'indexes, control, economies and stationed soldiers remain exact');
  assert.deepEqual(after.countries,saved.countries);assert.deepEqual(after.research,saved.research);
  const idx=f.Game.provinceById(small.id);assert.ok(idx>=0);
  assert.equal(f.MapView.provinceUnderPoint(old.R.nodes.find(n=>n.id===small.id).x,old.R.nodes.find(n=>n.id===small.id).y),idx);
  assert.equal(f.Game.load(f.Game.save()),true);assert.equal(f.R.nodes.length,171);
  f.Game.init('ger','fas',null,'standard','sandbox36');assert.equal(f.Game.state.provinces.length,418);assert.equal(f.R.nodes.length,111);
  assert.equal(f.Game.provinceById(small.id),-1,'new campaign removes the small garrison slot');
});

test('v2 saves preserve all province indexes and contested territory removed from new v4 campaigns',()=>{
  const old=setup({mapVersion:'v2'}),f=setup({map:true});
  assert.equal(old.Game.state.provinces.length,462);assert.equal(old.R.nodes.length,155);
  const removed=f.S.compactRegionMerges.find(merge=>old.Game.provinceById(merge.id)>=0);
  const province=old.Game.province(old.Game.provinceById(removed.id));province.owner='ger';
  const saved=plain(old.Game.state);assert.equal(f.Game.load(JSON.stringify(saved)),true);
  assert.equal(f.R.version,'strategic-balanced-2');assert.equal(f.R.nodes.length,155);
  assert.deepEqual(plain(f.Game.state.provinces),saved.provinces);
  assert.equal(f.MapView.provinceUnderPoint(province.x,province.y),old.Game.provinceById(province.id));
  assert.equal(f.Game.load(f.Game.save()),true);assert.equal(f.Game.state.provinces.length,462);
});
test('failed version selection restores the active v1, v2, v3, v4 or legacy geometry without changing the save',()=>{
  const legacy=setup({balanced:false}),v1=setup({mapVersion:'v1'}),v2=setup({mapVersion:'v2'}),v3=setup({mapVersion:'v3'}),f=setup({map:true});
  for(const [source,count,nodes,version]of [[f,418,111,'strategic-balanced-4'],[v3,433,126,'strategic-balanced-3'],[v2,462,155,'strategic-balanced-2'],[v1,478,171,'strategic-balanced-1'],[legacy,470,266,legacy.R.version]]){
    assert.equal(f.Game.load(source.Game.save()),true);const before=f.Game.save();
    const invalid=JSON.parse(before);invalid.strategicRegionsVersion='unsupported-future-map';
    assert.equal(f.Game.load(JSON.stringify(invalid)),false);
    assert.equal(f.Game.save(),before);assert.equal(f.Game.state.provinces.length,count);assert.equal(f.R.nodes.length,nodes);assert.equal(f.R.version,version);
    for(const id of ['ger_hamburg','uk_london','neu_poland']){
      const i=f.Game.provinceById(id),anchor=f.MapView.getProvinceAnchor(i);
      assert.equal(f.MapView.provinceUnderPoint(anchor.x,anchor.y),i,id+' restored hit testing');
    }
  }
});
test('map border strokes remove retired internal boundaries and rebuild for an older province map',()=>{
  const f=setup({map:true}),old=setup({balanced:false}),segments=[];
  for(const list of Object.values(f.S.members)){
    if(list.length<2)continue;
    const seen=new Map();
    for(const id of list)for(const region of old.R.regionsFor(id))for(const ring of region.rings)for(let index=0;index<ring.length;index++){
      const from=ring[index],to=ring[(index+1)%ring.length],first=from.map(value=>value.toFixed(6)).join(','),second=to.map(value=>value.toFixed(6)).join(',');
      const key=[first,second].sort().join('|');
      if(seen.has(key)&&seen.get(key)!==id)segments.push(`M${from[0]},${from[1]}L${to[0]},${to[1]}`);
      else seen.set(key,id);
    }
  }
  assert.ok(segments.length>0);f.MapView.render();
  const paths=()=>f.layers.get('layerBorders').children.filter(node=>node.attrs.class==='historical-administrative-borders').flatMap(node=>node.children);
  const active=new Set(paths().flatMap(node=>node.attrs.d.split(' ')));
  assert.ok(segments.every(segment=>!active.has(segment)),'merged administrative interiors have no visible dividing stroke');
  assert.equal(f.Game.load(old.Game.save()),true);f.MapView.render();
  const legacy=new Set(paths().flatMap(node=>node.attrs.d.split(' ')));
  assert.ok(legacy.size>active.size,'legacy save rebuilds its independent province borders');
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
