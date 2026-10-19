const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(start = true){
  const saved = new Map();
  const context = vm.createContext({
    window:{}, console,
    localStorage:{getItem:key => saved.get(key) ?? null, setItem:(key,value) => saved.set(key,value)},
    Math:Object.create(Math),
  });
  context.Math.random = () => 0.99;
  for (const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  }
  const Game = vm.runInContext('Game',context);
  if (start) Game.init('ger','fas',null,'standard','1936');
  return {Game,saved,context};
}

function startAndClaim(Game){
  const techId = vm.runInContext('TECHS.find(t => t.pre.length === 0).id',Game._testContext);
  assert.equal(Game.assignResearch(techId,0),true);
  assert.equal(Game.buildUnit('infantry'),true);
  assert.equal(Game.getCampaign().status,'ready');
  const pc = Game.country(Game.state.player);
  const before = [pc.pp,pc.equipment];
  assert.equal(Game.claimCampaignReward(),true);
  assert.equal(pc.pp,before[0]+30);
  assert.equal(pc.equipment,before[1]+20);
  assert.equal(Game.claimCampaignReward(),false);
  assert.equal(Game.state.campaign.stageIndex,1);
  return techId;
}

function reachFinal(Game){
  startAndClaim(Game);
  assert.equal(Game.buildUnit('infantry'),true);
  assert.equal(Game.buildFactory('civ'),true);
  assert.equal(Game.getCampaign().status,'active');
  for (let i=0;i<4;i++) Game.endTurn();
  assert.equal(Game.state.campaign.counters.unitsTrained,2);
  assert.equal(Game.state.campaign.counters.factoriesBuilt,1);
  assert.equal(Game.state.campaign.counters.researchCompleted,1);
  assert.equal(Game.getCampaign().status,'ready');
  assert.equal(Game.claimCampaignReward(),true);
  assert.equal(Game.getCampaign().stageIndex,2);
}

test('real orders and completions advance stages; rewards require explicit claim and cannot repeat',()=>{
  const {Game,context} = setup(); Game._testContext = context;
  assert.equal(Game.getCampaign().stageIndex,0);
  assert.equal(Game.getCampaign().tasks[0].view,'research');
  assert.equal(Game.buildUnit('does-not-exist'),false);
  assert.equal(Game.state.campaign.counters.unitOrdered,0);
  reachFinal(Game);
  assert.equal(Game.getCampaign().status,'active');
  assert.equal(Game.getCampaign().tasks[0].view,'campaign');
  assert.equal(Game.claimCampaignReward(),false);
});

test('industry route counts built factories since baseline and stability, then caps reward',()=>{
  const {Game,context} = setup(); Game._testContext = context;
  reachFinal(Game);
  assert.equal(Game.chooseStrategy('industry'),true);
  assert.equal(Game.chooseStrategy('invalid'),false);
  const pc = Game.country(Game.state.player);
  pc.res += 200;
  assert.equal(Game.buildFactory('civ'),true);
  assert.equal(Game.buildFactory('mil'),true);
  for (let i=0;i<3;i++) Game.endTurn();
  assert.equal(Game.state.campaign.counters.factoriesBuilt,3);
  pc.stability = 99;
  assert.equal(Game.getCampaign().status,'ready');
  const pp = pc.pp;
  assert.equal(Game.claimCampaignReward(),true);
  assert.equal(pc.pp,pp+60);
  assert.equal(pc.stability,100);
  assert.equal(Game.getCampaign().status,'complete');
  assert.equal(Game.claimCampaignReward(),false);
  assert.equal(Game.chooseStrategy('expansion'),false);
});

test('expansion route counts newly held province IDs, not retaken original provinces',()=>{
  const {Game,context} = setup(); Game._testContext = context;
  reachFinal(Game);
  assert.equal(Game.chooseStrategy('expansion'),true);
  const s = Game.state, home = s.provinces.findIndex((p,i) => p.owner === s.player && Game.neighbors(i).some(j => s.provinces[j].owner !== s.player));
  assert.ok(home >= 0);
  const original = s.provinces[home].id;
  s.provinces[home].owner = 'fra';
  s.provinces[home].owner = s.player;
  assert.equal(Game.getCampaign().tasks[0].current,0);
  // Use the game's assault path; clear defenders to make the outcome deterministic.
  const targets = Game.neighbors(home).filter(i => s.provinces[i].owner !== s.player).slice(0,2);
  assert.equal(targets.length,2);
  s.provinces[home].garrison = Array.from({length:8},(_,i) => ({...s.provinces[home].garrison[0],id:'campaign-unit-'+i}));
  targets.forEach(i => { s.provinces[i].garrison = []; Game.doAssault(s.player,home,i,0,1); });
  assert.equal(Game.getCampaign().tasks[0].current,0);
  for(let i=0;i<3;i++)Game.advanceDay();
  assert.equal(Game.getCampaign().tasks[0].current,0);assert.ok(Game.getCombats().every(combat=>combat.status==='occupation'));
  for(let day=0;day<7&&targets.some(index=>s.provinces[index].owner!==s.player);day++)Game.advanceDay();
  assert.equal(Game.getCampaign().tasks[0].current,2);
  assert.equal(Game.getCampaign().status,'ready');
  assert.equal(Game.claimCampaignReward(),true);
  assert.equal(Game.getCampaign().status,'complete');
  assert.ok(s.campaign.initialProvinceIds.includes(original));
});

test('load migrates legacy save, reads storage without argument, and rolls back bad data',()=>{
  const {Game,saved} = setup();
  const before = Game.state;
  assert.equal(Game.load('null'),false);
  assert.equal(Game.load('{'),false);
  assert.strictEqual(Game.state,before);
  const legacy = JSON.parse(Game.save());
  delete legacy.campaign;
  saved.set('hoi_save_v2',JSON.stringify(legacy));
  assert.equal(Game.load(),true);
  assert.equal(Game.getCampaign().stageIndex,0);
  assert.equal(Game.state.campaign.initialProvinceIds.length,legacy.provinces.filter(p => p.owner === legacy.player).length);
  const loaded = Game.state;
  const bad = JSON.parse(Game.save()); bad.research.slots = null;
  assert.equal(Game.load(JSON.stringify(bad)),false);
  assert.strictEqual(Game.state,loaded);
  assert.equal(Game.autosave(),true);
  assert.equal(Game.load(),true);
  assert.equal(Game.getCampaign().stageIndex,0);
});

test('legacy saves with all technology researched remain able to finish research objectives',()=>{
  const {Game,context} = setup();
  const old = JSON.parse(Game.save());
  delete old.campaign;
  for (const id of vm.runInContext('TECHS.map(t => t.id)',context)) old.countries[old.player].researched[id] = true;
  old.buildQueue.push({kind:'div',unitType:'infantry',provinceIdx:old.countries[old.player].capitalIdx,turnsLeft:1,label:'步兵师'});
  assert.equal(Game.load(JSON.stringify(old)),true);
  assert.equal(Game.getCampaign().status,'ready');
  assert.equal(Game.claimCampaignReward(),true);
  assert.equal(Game.state.campaign.counters.researchCompleted > 0,true);
  assert.equal(Game.state.campaign.counters.unitOrdered,1);
});

test('a trained unit whose destination was lost is deployed in owned territory',()=>{
  const {Game} = setup();
  const s = Game.state;
  const target = s.provinces.findIndex((p,i) => p.owner === s.player && i !== Game.country(s.player).capitalIdx);
  assert.ok(target >= 0);
  s.selectedIdx = target;
  assert.equal(Game.buildUnit('infantry'),true);
  const enemyUnits = s.provinces[target].garrison.length;
  const capital = Game.country(s.player).capitalIdx;
  const homeUnits = s.provinces[capital].garrison.length;
  s.provinces[target].owner = 'fra';
  Game.endTurn();
  assert.equal(s.provinces[target].garrison.length,enemyUnits);
  assert.equal(s.provinces[capital].garrison.length,homeUnits+1);
  assert.equal(s.campaign.counters.unitsTrained,1);
});

test('load rejects gameplay-breaking nested data without replacing current state',()=>{
  const {Game} = setup();
  const original = Game.state, base = JSON.parse(Game.save());
  const corruptions = [
    s => { s.research.slots = ['unknown',null,null]; },
    s => { s.research.slots = [null]; },
    s => { s.buildQueue.push({kind:'div',unitType:'unknown',provinceIdx:0,turnsLeft:1}); },
    s => { s.adj[0] = [999999]; },
    s => { s.provinces[0].owner = 'unknown'; },
    s => { s.provinces[0].garrison[0].hp = null; },
    s => { s.wars = [null]; },
    s => { s.wars = [{a:'ger',b:'unknown'}]; },
    s => { delete s.countries.ger.rare; },
    s => { delete s.countries.fra.rare; },
  ];
  for (const corrupt of corruptions){
    const bad = JSON.parse(JSON.stringify(base)); corrupt(bad);
    assert.equal(Game.load(JSON.stringify(bad)),false);
    assert.strictEqual(Game.state,original);
  }
  assert.doesNotThrow(() => Game.endTurn());
  assert.equal(Number.isFinite(Game.country(Game.state.player).rare),true);
});

test('campaign progress and claimed rewards survive a save round trip',()=>{
  const {Game,context} = setup(); Game._testContext = context;
  startAndClaim(Game);
  assert.equal(Game.chooseStrategy('industry'),false);
  const original = JSON.parse(Game.save());
  Game.init('fra','dem',null,'standard','1936');
  assert.equal(Game.load(JSON.stringify(original)),true);
  assert.equal(Game.state.campaign.stageIndex,1);
  assert.equal(Game.state.campaign.rewards[0],true);
  assert.equal(Game.state.campaign.counters.unitOrdered,1);
  assert.equal(Game.claimCampaignReward(),false);
});

test('storage failure and empty state do not create null saves',()=>{
  const {Game,context,saved} = setup(false);
  assert.equal(Game.autosave(),false);
  assert.equal(saved.has('hoi_save_v2'),false);
  Game.init('ger','fas',null,'standard','1936');
  saved.clear();
  assert.equal(Game.load(),false);
  context.localStorage.setItem = () => { throw Error('quota'); };
  assert.equal(Game.autosave(),false);
  assert.equal(saved.has('hoi_save_v2'),false);
});

test('AI versus AI attacks stay in logs without interrupting the player',()=>{
  const {Game,context} = setup();
  const notices = [];
  const ui = {
    toast:(...args) => notices.push(['toast',...args]),
    sfx:(...args) => notices.push(['sfx',...args]),
    screenFlash:(...args) => notices.push(['flash',...args]),
    refresh:() => {},
  };
  context.UI = ui; context.window.UI = ui;
  const s = Game.state;
  const from = s.provinces.findIndex((p,i) => p.owner !== s.player && p.owner && Game.neighbors(i).length && p.garrison.length);
  const to = Game.neighbors(from).find(i => !s.provinces[i].isCapital);
  assert.ok(to >= 0);
  s.provinces[to].owner = s.provinces[from].owner === 'fra' ? 'ita' : 'fra';
  s.provinces[to].garrison = [];
  Game.doAssault(s.provinces[from].owner,from,to,0,1);
  assert.equal(notices.length,0);
  assert.match(s.log.at(-1).text,/准备作战/);
  for(let i=0;i<3;i++)Game.advanceDay();
  assert.ok(!s.log.some(entry=>entry.text.includes('攻占 '+s.provinces[to].name)));
  const combat=s.activeCombats.find(battle=>battle.from===from&&battle.to===to);assert.ok(combat);assert.equal(combat.phase,'engagement');
  for(let day=0;day<7&&s.activeCombats.some(battle=>battle.id===combat.id);day++)Game.advanceDay();
  assert.ok(s.log.some(entry=>entry.text.includes('攻占 '+s.provinces[to].name)));
  assert.equal(notices.length,0);
  assert.match(s.log[1].text,/直接进攻未交战国家/);
});
