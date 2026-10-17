const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
  const context=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});context.Math.random=()=>.5;
  for(const file of ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  const Game=vm.runInContext('Game',context);Game.init('ger','fas',null,'standard','sandbox36');
  const from=Game.provinceById('ita_rome'),target=Game.provinceById('fra_paris');
  Game.state.adj=Game.state.provinces.map(()=>[]);Game.state.seaAdj=Game.state.provinces.map(()=>[]);
  Game.state.adj[from]=[target];Game.state.adj[target]=[from];Game.province(from).garrison=Array.from({length:5},()=>Game.makeDivision('infantry'));
  Game.province(from).owner='ita';Game.province(target).owner='fra';Game.state.alliances['ger|ita']=true;Game.state.wars=[{a:'ger',b:'fra',since:'1936-1'}];
  return {Game,from,target};
}
test('a player without a route can request a bordering ally to join and launch a real attack with its own soldiers',()=>{
  const {Game,from,target}=setup(),before=Game.armyTotals('ger'),allyBefore=Game.armyTotals('ita').land;
  const option=Game.alliedAttackOptions(target).find(item=>item.allyId==='ita');assert.ok(option.available);assert.equal(option.from,from);assert.equal(option.joinWar,true);
  assert.equal(Game.requestAlliedAttack('ita',target),true);assert.equal(Game.isAtWar('ita','fra'),true);
  const combat=Game.state.activeCombats.find(item=>item.to===target);assert.ok(combat);assert.equal(combat.attacker,'ita');assert.equal(combat.from,from);assert.equal(combat.phase,'preparation');
  assert.ok(combat.attackers.every(entry=>entry.owner==='ita'));assert.ok(Game.province(from).garrison.some(unit=>unit.kind==='land'));
  assert.deepEqual(Game.armyTotals('ger'),before);assert.equal(Game.armyTotals('ita').land,allyBefore);
  assert.equal(Game.requestAlliedAttack('ita',target),false);assert.ok(Game.state.worldEvents.some(event=>event.countryIds.includes('ger')&&event.title.includes('应邀')));
  assert.equal(Game.load(Game.save()),true);
});
test('requests cannot force a neutral ally to attack a non-enemy or bypass actual province adjacency',()=>{
  const {Game,from,target}=setup();Game.state.wars=[];const before=Game.save();assert.equal(Game.requestAlliedAttack('ita',target),false);assert.equal(Game.save(),before);
  Game.state.wars=[{a:'ger',b:'fra',since:'1936-1'}];Game.state.adj[from]=[];assert.equal(Game.alliedAttackOptions(target).length,0);assert.equal(Game.requestAlliedAttack('ita',target),false);
});
