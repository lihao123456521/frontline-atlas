const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});
  ctx.Math.random=()=>.5;
  for(const name of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'),ctx);
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const types=vm.runInContext('UNIT_TYPES',ctx),key=vm.runInContext('relKey',ctx);
  const unit=type=>{const t=types[type];return {type,kind:t.kind,atk:t.atk,def:t.def,hp:t.hp,maxHp:t.hp,org:t.org,maxOrg:t.org};};
  const ally=id=>{Game.country('ger').pp=200;Game.state.relations[key('ger',id)]=60;Game.diploAction('ally',id);};
  return {Game,ctx,unit,key,ally};
}

test('alliance proposals are free, reject invalid governments and may end an existing war',()=>{
  const {Game,key}=setup(),c=Game.country('ger');c.pp=100;Game.state.relations[key('ger','fra')]=60;
  Game.diploAction('ally','fra');assert.equal(c.pp,100);
  Game.diploAction('ally','fra');assert.equal(c.pp,100);
  for(const target of ['ger','missing'])assert.equal(Game.diplomacyAvailability('ally',target).available,false);
  Game.country('uk').alive=false;assert.equal(Game.diplomacyAvailability('improve','uk').available,false);
  Game.state.wars.push({a:'ger',b:'ita'});Game.state.relations[key('ger','ita')]=200;
  assert.equal(Game.diplomacyAvailability('ally','ita').available,true);
  const pp=c.pp;assert.equal(Game.diploAction('ally','ita'),true);assert.equal(c.pp,pp);
  assert.equal(Game.isAllied('ger','ita'),true);assert.equal(Game.isAtWar('ger','ita'),false);
  assert.equal(Game.sovereigntyResponse().outcome,'allied');
});

test('zero political power and low relations never block a proposal while a hostile recipient may refuse',()=>{
  const {Game,key}=setup();const c=Game.country('ger');c.pp=0;Game.state.relations[key('ger','fra')]=-100;
  const before=Game.save(),a=Game.diplomacyAvailability('ally','fra');
  assert.equal(a.available,true);assert.equal(a.cost,0);assert.equal(a.predictedOutcome,'refused');assert.equal(Game.save(),before);
  assert.equal(Game.diploAction('ally','fra'),true);assert.equal(c.pp,0);assert.equal(Game.isAllied('ger','fra'),false);assert.equal(Game.sovereigntyResponse().outcome,'refused');
  assert.equal(Game.diplomacyAvailability('ally','fra').available,true);
  assert.equal(Game.diploAction('improve','fra'),true);assert.equal(c.pp,0);assert.equal(Game.relation('ger','fra'),-85);
  Game.state.relations[key('ger','fra')]=200;assert.equal(Game.diploAction('ally','fra'),true);assert.equal(Game.isAllied('ger','fra'),true);
});

test('a neutral recipient can accept an alliance without first grinding political power or relations',()=>{
  const {Game,key}=setup();Game.country('ger').pp=0;Game.state.relations[key('ger','fra')]=0;
  assert.equal(Game.diploAction('ally','fra'),true);assert.equal(Game.isAllied('ger','fra'),true);
  assert.equal(Game.country('ger').pp,0);assert.equal(Game.sovereigntyResponse().outcome,'allied');
});

test('allies cannot be declared on or damaged by land or amphibious combat',()=>{
  const {Game,unit,ally}=setup();ally('fra');
  const from=Game.provinceById('ger_hamburg'),to=Game.provinceById('fra_normandy');
  Game.province(from).garrison=[unit('infantry'),unit('navy')];Game.province(to).garrison=[unit('infantry'),unit('submarine')];
  const before=Game.save();assert.equal(Game.diploAction('declare','fra'),false);
  assert.equal(Game.doAssault('ger',from,to,0,1),false);assert.equal(Game.amphibious(from,to,1),false);
  assert.equal(Game.save(),before);
});

test('offensive alliances require explicit call and repeated calls do not duplicate wars',()=>{
  const {Game,ally}=setup();ally('ita');
  assert.equal(Game.diploAction('declare','fra'),true);assert.equal(Game.isAtWar('ita','fra'),false);
  const pp=Game.country('ger').pp;assert.equal(Game.diplomacyAvailability('call','ita','fra').available,true);
  assert.equal(Game.callAlly('ita','fra'),true);assert.equal(Game.isAtWar('ita','fra'),true);
  assert.equal(Game.country('ger').pp,pp);const n=Game.state.wars.length;
  assert.equal(Game.callAlly('ita','fra'),false);assert.equal(Game.state.wars.length,n);
});

test('call rejects non-allies, unknown enemies, peaceful targets and ally-on-ally wars',()=>{
  const {Game,ally,key}=setup();ally('ita');
  assert.equal(Game.callAlly('uk','fra'),false);assert.equal(Game.callAlly('ita','missing'),false);
  assert.equal(Game.callAlly('ita','fra'),false);
  Game.state.alliances[key('ita','fra')]=true;Game.diploAction('declare','fra');
  assert.equal(Game.isAtWar('ita','ger'),false);assert.equal(Game.callAlly('ita','fra'),false);
  assert.ok(Game.diplomacyAvailability('call','ita','fra').reasons.some(r=>r.includes('同盟')));
});

test('defensive alliance joins when attacked and never creates an ally-enemy pair',()=>{
  const {Game,ally,unit,key}=setup();ally('ita');
  const from=Game.state.provinces.findIndex(p=>p.owner==='fra'),to=Game.state.provinces.findIndex(p=>p.owner==='ger');
  Game.province(from).garrison=[unit('infantry')];Game.province(to).garrison=Array.from({length:5},()=>unit('armor'));
  Game.state.adj[from]=[to];Game.state.adj[to]=[from];
  Game.doAssault('fra',from,to,0,1);assert.equal(Game.isAtWar('ita','fra'),true);
  assert.equal(Game.isAllied('ita','ger'),true);
  for(const w of Game.state.wars)assert.equal(!!Game.state.alliances[key(w.a,w.b)],false);
});

function configureAllyFront(Game,unit,sea){
  const from=Game.provinceById('ita_rome'),to=Game.provinceById('fra_normandy');
  Game.state.provinces.forEach(p=>{p.garrison=[];});
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.province(from).garrison=Array.from({length:8},()=>unit('armor'));
  if(sea){Game.province(from).garrison.push(unit('navy'));Game.state.coastal[from]=Game.state.coastal[to]=true;Game.state.seaAdj[from]=[to];Game.state.seaAdj[to]=[from];}
  else {Game.state.adj[from]=[to];Game.state.adj[to]=[from];}
  Game.province(to).garrison=[unit('infantry')];
  return {from,to};
}
for(const sea of [false,true])test('called ally fights shared AI enemy by '+(sea?'sea':'land')+' without attacking player',()=>{
  const {Game,unit,ally}=setup();ally('ita');Game.diploAction('declare','fra');
  assert.equal(Game.callAlly('ita','fra'),true);const {to}=configureAllyFront(Game,unit,sea);
  Game.endTurn();assert.ok(Game.state.activeCombats.some(b=>b.attacker==='ita'&&b.defender==='fra'&&b.to===to));
  assert.equal(Game.state.recentBattles.some(b=>b.attacker==='ita'&&b.defender==='fra'&&b.to===to),false);
  for(let i=0;i<30;i++)Game.advanceDay();
  assert.ok(Game.state.recentBattles.some(b=>b.attacker==='ita'&&b.defender==='fra'&&b.to===to));
  assert.equal(Game.isAtWar('ita','ger'),false);
});

test('automatic logistics uses real trade, military research and bounded infantry with reserves',()=>{
  const {Game}=setup();assert.equal(Game.autoLogisticsStatus().enabled,true);
  Game.state.provinces.forEach(p=>{if(p.owner==='ger')p.garrison=[];});
  const c=Game.country('ger');c.mil=0;c.res=200;c.equipment=35;c.manpower=100;
  Game.endTurn();const status=Game.autoLogisticsStatus();
  assert.ok(status.actions.some(a=>a.includes('贸易')));assert.ok(status.actions.some(a=>a.includes('步兵')));
  assert.ok(status.actions.some(a=>a.includes('研发')));assert.ok(c.res>=40);assert.ok(c.equipment>=24);assert.ok(c.manpower>=5);
  const recruitment=Game.autoRecruitmentStatus(),queue=Game.state.buildQueue.filter(item=>item.kind==='div');
  const formations=queue.reduce((sum,item)=>sum+(item.formationPermille||1000),0)/1000;
  assert.equal(recruitment.provincial,true);assert.ok(formations>0&&formations<=2);
  assert.equal(recruitment.queued,formations);assert.equal(recruitment.queuedPersonnel,formations*10000);
  assert.ok(queue.every(item=>item.unitType==='infantry'&&Game.province(item.provinceIdx).owner==='ger'));
  assert.equal(Game.state.wars.some(w=>w.a==='ger'||w.b==='ger'),false);
  assert.ok(Game.state.research.slots.filter(Boolean).length);assert.ok(status.summary.length);
});

test('automatic logistics handles low stock, full queues and disabled mode without automatic spending',()=>{
  const {Game}=setup();const c=Game.country('ger');
  Game.state.provinces.forEach(p=>{if(p.owner==='ger'){p.garrison=[];p.resource=0;}});
  c.civ=c.mil=c.eff.resOut=c.eff.factoryOut=c.eff.equip=0;
  c.res=1;c.equipment=0;c.manpower=0;Game.endTurn();assert.equal(Game.autoLogisticsStatus().actions.some(a=>a.startsWith('贸易：')||a.startsWith('训练步兵：')),false);
  assert.ok(Game.autoLogisticsStatus().reasons.length);assert.ok(c.res>=0&&c.equipment>=0);
  c.res=500;c.equipment=500;c.manpower=500;
  const home=Game.state.provinces.findIndex(p=>p.owner==='ger');
  Game.state.buildQueue=[0,1].map(()=>({kind:'div',unitType:'infantry',provinceIdx:home,turnsLeft:20,label:'步兵'}));
  Game.endTurn();assert.equal(Game.state.buildQueue.length,2);
  Game.setAutoLogistics(false);Game.state.research.slots=[null,null,null];
  const equip=c.equipment,res=c.res;Game.endTurn();
  assert.equal(Game.autoLogisticsStatus().enabled,false);assert.equal(Game.state.buildQueue.length,2);
  assert.equal(c.res,res+Game.incomePreview().res);assert.equal(c.equipment,equip+Game.incomePreview().eq);
  assert.equal(Game.state.research.slots.filter(Boolean).length,0);
});

test('legacy saves gain automatic logistics and contradictory alliance-war pairs are repaired',()=>{
  const {Game,key}=setup(),old=JSON.parse(Game.save());delete old.autoLogistics;
  old.alliances[key('ger','fra')]=true;old.wars.push({a:'ger',b:'fra'});
  assert.equal(Game.load(JSON.stringify(old)),true);assert.equal(Game.autoLogisticsStatus().enabled,true);
  assert.equal(Game.isAllied('ger','fra'),false);assert.equal(Game.isAtWar('ger','fra'),true);
  Game.setAutoLogistics(false);const saved=Game.save();assert.equal(Game.load(saved),true);assert.equal(Game.autoLogisticsStatus().enabled,false);
});
