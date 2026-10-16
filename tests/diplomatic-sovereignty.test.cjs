const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function setup(full=true){
  const ctx=vm.createContext({window:{},console,Math:Object.create(Math),localStorage:{getItem:()=>null,setItem:()=>{}}});ctx.Math.random=()=>.99;
  const excluded=new Set(['runtime.js','map.js','ui.js','tutorial.js','main.js','world-news.js','global-overview.js']);
  const scripts=full?[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="js\/([^?"/]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]).filter(file=>!excluded.has(file)):
    ['data.js','data_world.js','data_provinces.js','campaign.js','game.js'];
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),ctx,{filename:file});
  const Game=vm.runInContext('Game',ctx);Game.init('ger','fas',null,'standard','sandbox36');
  const key=vm.runInContext('relKey',ctx),c=Game.country('ger');c.pp=200;c.stability=80;
  const from=Game.state.provinces.findIndex(p=>p.owner==='ger'),to=Game.state.provinces.findIndex(p=>p.owner==='aut');
  if(!full){Game.state.adj[from].push(to);Game.state.adj[to].push(from);}
  return {Game,ctx,key,from,to};
}
function units(Game){return Game.state.provinces.flatMap(p=>p.garrison).concat(Game.state.activeCombats.flatMap(c=>c.attackers.map(e=>e.unit)));}
function readiness(Game){return units(Game).map(unit=>({id:unit.id,hp:unit.hp,org:unit.org})).sort((a,b)=>a.id.localeCompare(b.id));}
test('real 1936 Germany can freely propose a peaceful Austria annexation that transfers actual land, troops, industry and finite reserves once',()=>{
  const {Game,key}=setup(true),c=Game.country('ger'),target=Game.country('aut');Game.state.relations[key('ger','aut')]=100;
  const status=Game.diplomacyAvailability('annex','aut');
  assert.equal(status.available,true,status.reasons.join(';'));assert.equal(status.mode,'proposal');assert.equal(status.cost,0);
  const beforeUnits=JSON.stringify(readiness(Game)),sum={};
  for(const field of ['res','oil','rare','equipment','civ','mil','manpower','manpowerCap'])sum[field]=c[field]+target[field];
  const pool={};for(const field of ['capacity','reserve','consumed'])pool[field]=c.mobilization[field]+target.mobilization[field];
  const land=Game.state.provinces.filter(p=>p.owner==='aut').map(p=>p.id),wt=Game.state.wt,pp=c.pp;
  assert.equal(Game.diploAction('annex','aut'),true);assert.equal(c.pp,pp-status.cost);assert.equal(Game.state.wt,Math.min(100,wt+10));
  assert.equal(target.alive,false);assert.ok(land.every(id=>Game.province(Game.provinceById(id)).owner==='ger'));
  assert.equal(units(Game).some(unit=>unit.owner==='aut'),false);assert.equal(JSON.stringify(readiness(Game)),beforeUnits);
  for(const field of Object.keys(sum)){assert.equal(c[field],sum[field]);assert.equal(target[field],0);}
  for(const field of Object.keys(pool)){assert.equal(c.mobilization[field],pool[field]);assert.equal(target.mobilization[field],0);}
  assert.equal(Game.load(Game.save()),true);assert.equal(JSON.stringify(readiness(Game)),beforeUnits);
  const saved=Game.save();assert.equal(Game.diploAction('annex','aut'),false);assert.equal(Game.save(),saved);
});
test('invalid peaceful annexation and puppet proposals never charge or alter the map',()=>{
  const {Game,key}=setup();
  for(const action of ['annex','puppet'])for(const id of ['ger','missing','__proto__']){
    const saved=Game.save();assert.equal(Game.diploAction(action,id),false);assert.equal(Game.save(),saved);
  }
  assert.equal(Game.diplomacyAvailability('annex','fra').available,true,'a weaker country can still submit a proposal and receive refusal');
  Game.country('ger').pp=0;assert.equal(Game.diplomacyAvailability('annex','aut').available,true);
  Game.state.wars.push({a:'ger',b:'aut'});
  assert.equal(Game.diplomacyAvailability('annex','aut').available,true);
  Game.state.wars=[];Game.state.relations[key('ger','aut')]=-200;assert.equal(Game.diplomacyAvailability('puppet','aut').predictedOutcome,'refused');
});
test('puppet sovereignty preserves independent territory and armies while enforcing defensive passage and refusing attacks inside its bloc',()=>{
  const {Game,key,from,to}=setup();Game.state.relations[key('ger','aut')]=60;
  const provinces=JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),before=Game.country('ger').pp;
  assert.equal(Game.diploAction('puppet','aut'),true);assert.equal(Game.country('ger').pp,before);
  assert.equal(Game.country('aut').subjectOf,'ger');assert.equal(Game.subjectStatus('aut').tributeRate,.1);
  assert.equal(JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),provinces);
  assert.equal(Game.isAllied('ger','aut'),true);assert.ok(Game.landRoute(from,to,'ger'));
  assert.equal(Game.diplomacyAvailability('declare','aut').available,false);
  assert.equal(Game.doAssault('aut',to,from,0,1,true),false);
  const french=Game.state.provinces.findIndex(p=>p.owner==='fra');Game.state.adj[french]=[to];Game.state.adj[to].push(french);
  assert.equal(Game.doAssault('fra',french,to,0,1,true),true);
  assert.equal(Game.isAtWar('ger','fra'),true,'attacking a puppet triggers the sovereign defensive alliance');
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.country('aut').subjectOf,'ger');
});
test('monthly puppet tribute transfers only ten percent of real income and keeps global resource totals conserved',()=>{
  const run=puppet=>{
    const {Game,key}=setup();Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);
    for(const p of Game.state.provinces)for(const unit of p.garrison){unit.hp=unit.maxHp;unit.org=unit.maxOrg;}
    if(puppet){Game.state.relations[key('ger','aut')]=60;assert.equal(Game.diploAction('puppet','aut'),true);}
    const before={ger:{},aut:{}};for(const id of ['ger','aut'])for(const field of ['res','oil','rare','equipment'])before[id][field]=Game.country(id)[field];
    Game.endTurn();return {Game,before};
  };
  const independent=run(false),subject=run(true);
  for(const field of ['res','oil','rare','equipment']){
    const gain=independent.Game.country('aut')[field]-independent.before.aut[field],tribute=Math.floor(gain*.1);
    assert.equal(subject.Game.country('aut')[field],independent.Game.country('aut')[field]-tribute,field+' debit');
    assert.equal(subject.Game.country('ger')[field],independent.Game.country('ger')[field]+tribute,field+' credit');
  }
});
test('releasing a puppet cancels invalid routes and returns the exact marching units without retaining travel metadata',()=>{
  const {Game,key,from,to}=setup();Game.state.relations[key('ger','aut')]=60;assert.equal(Game.diploAction('puppet','aut'),true);
  const enemy=Game.state.provinces.findIndex(p=>p.owner==='ita');Game.state.adj[from]=[to];Game.state.adj[to]=[from,enemy];Game.state.adj[enemy]=[to];
  const original=Game.province(from).garrison[0],hp=original.hp;
  assert.equal(Game.doAssault('ger',from,enemy,0,1,true),true);assert.equal(Game.state.activeCombats.length,1);
  assert.equal(Game.diploAction('release','aut'),true);assert.equal(Game.country('aut').subjectOf,null);assert.equal(Game.isAllied('ger','aut'),false);
  assert.equal(Game.state.activeCombats.length,0);assert.equal(units(Game).filter(unit=>unit.id===original.id).length,1);
  assert.equal(original.hp,hp);for(const field of ['combatId','arrivalDay','routePath','returnFrom'])assert.equal(original[field],undefined);
  assert.equal(Game.load(Game.save()),true);
});
test('integrating a puppet stays free and transfers paid pending production without duplication',()=>{
  const {Game,key,to}=setup();Game.state.relations[key('ger','aut')]=60;Game.diploAction('puppet','aut');
  Game.state.aiBuildQueue.push({countryId:'aut',unitType:'infantry',provinceIdx:to,turnsLeft:1});
  assert.equal(Game.diplomacyAvailability('annex','aut').cost,0);const count=units(Game).length;
  assert.equal(Game.diploAction('annex','aut'),true);assert.equal(Game.state.aiBuildQueue.some(item=>item.countryId==='aut'),false);
  assert.equal(Game.state.buildQueue.filter(item=>item.kind==='div').length,1);assert.equal(units(Game).length,count);
  Game.setAutoRecruitment({enabled:false});Game.setAutoLogistics(false);Game.endTurn();
  assert.equal(units(Game).filter(unit=>unit.owner==='ger').length>0,true);assert.equal(Game.load(Game.save()),true);
});
test('subject saves reject invalid, circular, nested and internally warring sovereignty without replacing current state',()=>{
  const {Game,key}=setup();Game.state.relations[key('ger','aut')]=60;Game.diploAction('puppet','aut');const current=Game.state;
  for(const mutate of [s=>s.countries.aut.subjectOf='aut',s=>s.countries.aut.subjectOf='missing',s=>s.countries.aut.subjectOf=3,
    s=>s.countries.ger.subjectOf='aut',s=>{s.countries.ger.subjectOf='fra';},s=>s.wars.push({a:'aut',b:'ger'})]){
    const bad=JSON.parse(Game.save());mutate(bad);assert.equal(Game.load(JSON.stringify(bad)),false);assert.equal(Game.state,current);
  }
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.subjectStatus('ger').subjects[0],'aut');
});
test('subjects cannot initiate new wars through AI, direct assaults or player justification while defensive participation remains valid',()=>{
  const {Game,ctx,key,to}=setup();Game.state.relations[key('ger','aut')]=60;assert.equal(Game.diploAction('puppet','aut'),true);
  const enemy=Game.state.provinces.findIndex(p=>p.owner==='ita');Game.state.adj[to]=[enemy];Game.state.adj[enemy]=[to];
  Game.province(to).garrison=Array.from({length:8},()=>Game.makeDivision('armor'));Game.province(enemy).garrison=[];
  Game.country('aut').pp=200;Game.country('aut').manpower=1000;Game.country('aut').equipment=1000;Game.country('aut').res=1000;
  assert.equal(Game.doAssault('aut',to,enemy,0,4,true),false);assert.equal(Game.isAtWar('aut','ita'),false);
  Game.state.justifies['aut|ita']=1;Game.endTurn();assert.equal(Game.state.justifies['aut|ita'],0);assert.equal(Game.isAtWar('aut','ita'),false);
  Game.state.player='aut';assert.equal(Game.diplomacyAvailability('declare','ita').available,false);
  assert.equal(Game.diplomacyAvailability('justify','ita').available,false);Game.state.player='ger';
  const nextDecisionDay=Math.ceil((Game.state.daysElapsed+1+330)/7)*7-330;
  for(const c of Object.values(Game.state.countries))if(c.id!=='aut')c.aiWarDay=nextDecisionDay-1;
  Game.state.daysElapsed=nextDecisionDay-1;ctx.Math.random=()=>0;
  Game.advanceDay();assert.equal(Game.isAtWar('aut','ita'),false);assert.equal(Game.state.activeCombats.some(c=>c.attacker==='aut'),false);
  assert.equal(Game.diploAction('declare','ita'),true);assert.equal(Game.callAlly('aut','ita'),true);
  assert.equal(Game.doAssault('aut',to,enemy,0,4,true),true,'a called subject can fight a war already joined by its sovereign');
});
test('the historical Austria news event never claims an unperformed annexation or awards fake annexation stock',()=>{
  const {Game,ctx}=setup(),event=vm.runInContext("SCRIPTED_EVENTS.find(event=>event.id==='anschluss')",ctx);
  const owners=JSON.stringify(Game.state.provinces.map(p=>p.owner)),res=Game.country('ger').res;
  event.choices[0].apply(Game.country('ger'),Game.state);
  assert.equal(Game.country('ger').res,res);assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.owner)),owners);
  assert.match(event.text,/外交/);assert.doesNotMatch(event.text,/奥地利并入德国/);
});
test('generic sovereign proposals can annex, compromise on a puppet, or refuse without fees and retry delays',()=>{
  for(const [targetId,relations,stability,outcome]of [['hun',100,20,'annexed'],['rom',100,30,'puppeted'],['uk',-100,100,'refused']]){
    const {Game,key}=setup();Game.state.player='ita';const c=Game.country('ita'),target=Game.country(targetId);c.pp=200;c.stability=80;
    Game.state.relations[key('ita',targetId)]=relations;target.stability=stability;
    const status=Game.diplomacyAvailability('annex',targetId),before=JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),pp=c.pp,wt=Game.state.wt;
    assert.equal(status.available,true,status.reasons.join(';'));assert.equal(status.predictedOutcome,outcome,status.responseReason);
    assert.match(status.responseReason,/实际陆军兵员比/);assert.ok(status.responseLikelihood>=0&&status.responseLikelihood<=100);
    assert.equal(Game.diploAction('annex',targetId),true);const response=Game.sovereigntyResponse();
    assert.equal(response.action,'annex');assert.equal(response.target,targetId);assert.equal(response.outcome,outcome);assert.equal(c.pp,pp-response.costs.pp);
    assert.ok(response.reason.length>0);assert.equal(response.costs.pp,status.cost);
    if(outcome==='annexed'){assert.equal(target.alive,false);assert.equal(Game.state.provinces.some(p=>p.owner===targetId),false);}
    else {
      assert.equal(JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),before);
      if(outcome==='puppeted'){assert.equal(target.subjectOf,'ita');assert.equal(response.costs.pp,0);}
      else {
        assert.equal(target.subjectOf,null);assert.equal(response.costs.pp,0);assert.equal(c.stability,80);assert.equal(Game.state.wt,wt);
        assert.equal(Game.diplomacyAvailability('annex',targetId).cooldownDays,0);
        const refusedSave=Game.save();assert.equal(Game.diploAction('puppet',targetId),true);assert.equal(Game.sovereigntyResponse().outcome,'refused');
        assert.equal(Game.load(refusedSave),true);assert.equal(Game.diplomacyAvailability('annex',targetId).available,true);
      }
    }
  }
});
test('any independent country may request another government protection without surrendering its army or territory',()=>{
  const {Game,key}=setup();Game.state.player='aut';Game.country('aut').pp=100;Game.state.relations[key('aut','ger')]=100;
  const before=JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),status=Game.diplomacyAvailability('submit','ger');
  assert.equal(status.available,true,status.reasons.join(';'));assert.equal(status.predictedOutcome,'puppeted');assert.equal(status.cost,0);
  assert.equal(Game.diploAction('submit','ger'),true);assert.equal(Game.country('aut').subjectOf,'ger');
  assert.equal(JSON.stringify(Game.state.provinces.map(p=>({owner:p.owner,garrison:p.garrison}))),before);
  const response=Game.sovereigntyResponse();assert.equal(response.action,'submit');assert.equal(response.outcome,'puppeted');assert.equal(response.subject,'aut');assert.equal(response.overlord,'ger');
  assert.equal(Game.load(Game.save()),true);assert.equal(Game.sovereigntyResponse().action,'submit');
});
test('diplomatic proposals remain available at zero political power and stability across dates, tension and previous refusals',()=>{
  const {Game,key}=setup();Game.country('ger').pp=0;Game.country('ger').stability=0;
  Game.state.relations[key('ger','fra')]=-200;Game.state.sovereigntyCooldowns['ger|fra']=Game.state.daysElapsed;
  for(const year of [1936,1939,1942])for(const wt of [0,100]){
    Game.state.date.year=year;Game.state.wt=wt;
    for(const action of ['annex','puppet','submit','ally']){
      const status=Game.diplomacyAvailability(action,'fra');
      assert.equal(status.available,true,action+': '+status.reasons.join(';'));assert.equal(status.cost,0);assert.equal(status.cooldownDays,0);
    }
  }
  Game.state.wars.push({a:'ger',b:'fra'});
  for(const action of ['annex','puppet','submit','ally','surrender'])assert.equal(Game.diplomacyAvailability(action,'fra').available,true,action);
});
test('wartime surrender can annex a much weaker government and returns every marching unit exactly once before unification',()=>{
  const {Game,key}=setup();Game.country('ger').pp=0;
  const to=Game.state.provinces.findIndex((p,i)=>p.owner==='aut'&&Game.neighbors(i).some(next=>Game.province(next).owner==='ger'));
  assert.ok(to>=0,'official map has a German-Austrian land border');
  const from=Game.neighbors(to).find(idx=>Game.province(idx).owner==='ger');
  Game.province(from).garrison.push(Game.makeDivision('infantry'),Game.makeDivision('armor'));
  assert.equal(Game.diploAction('declare','aut'),true);assert.equal(Game.doAssault('ger',from,to,0,1,true),true);
  assert.equal(Game.state.activeCombats.length,1);const before=JSON.stringify(readiness(Game));
  const status=Game.diplomacyAvailability('surrender','aut');assert.equal(status.available,true);assert.equal(status.predictedOutcome,'annexed',status.responseReason);
  assert.equal(Game.diploAction('surrender','aut'),true);assert.equal(Game.country('aut').alive,false);assert.equal(Game.isAtWar('ger','aut'),false);
  assert.equal(Game.state.activeCombats.length,0);assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(Game.country('ger').pp,0);
  assert.equal(new Set(units(Game).map(unit=>unit.id)).size,units(Game).length);
  assert.equal(Game.sovereigntyResponse().action,'surrender');assert.equal(Game.sovereigntyResponse().outcome,'annexed');
  assert.equal(Game.load(Game.save()),true);
});
test('a weaker country may ask an undefeated major power to surrender but receives a free repeatable refusal',()=>{
  const {Game,key}=setup();Game.state.player='aut';Game.country('aut').pp=0;
  assert.equal(Game.diplomacyAvailability('surrender','ger').available,false);
  Game.state.wars.push({a:'aut',b:'ger'});Game.state.relations[key('aut','ger')]=-200;
  const before=JSON.stringify(readiness(Game)),owners=JSON.stringify(Game.state.provinces.map(p=>p.owner));
  const status=Game.diplomacyAvailability('surrender','ger');assert.equal(status.available,true);assert.equal(status.predictedOutcome,'refused');
  for(let attempt=0;attempt<2;attempt++){
    assert.equal(Game.diploAction('surrender','ger'),true);assert.equal(Game.sovereigntyResponse().outcome,'refused');
    assert.equal(Game.diplomacyAvailability('surrender','ger').available,true);assert.equal(Game.country('aut').pp,0);
  }
  assert.equal(JSON.stringify(readiness(Game)),before);assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.owner)),owners);assert.equal(Game.isAtWar('aut','ger'),true);
  assert.equal(Game.load(Game.save()),true);
});
test('wartime puppet proposals preserve armies and territory while ending all wars of the joining government',()=>{
  const {Game,key}=setup();Game.country('ger').pp=0;Game.state.relations[key('ger','aut')]=100;
  Game.state.wars.push({a:'aut',b:'ger'},{a:'aut',b:'ita'});
  const before=JSON.stringify(readiness(Game)),owners=JSON.stringify(Game.state.provinces.map(p=>p.owner));
  assert.equal(Game.diploAction('puppet','aut'),true);assert.equal(Game.country('aut').subjectOf,'ger');
  assert.equal(Game.state.wars.some(w=>w.a==='aut'||w.b==='aut'),false);assert.equal(JSON.stringify(readiness(Game)),before);
  assert.equal(JSON.stringify(Game.state.provinces.map(p=>p.owner)),owners);assert.equal(Game.load(Game.save()),true);
});
