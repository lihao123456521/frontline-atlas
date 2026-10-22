const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(theater='taiping_1853',real=false,factions=null){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.style={};this.dataset={};this.attributes={};this._html='';this._text='';this.value='';this.disabled=false;this.classes=new Set();this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name)),contains:name=>this.classes.has(name),toggle:(name,on)=>{if(on===undefined)on=!this.classes.has(name);on?this.classes.add(name):this.classes.delete(name);return on;}};}
    set innerHTML(value){this._html=value;this._text='';this.children=[];}
    get innerHTML(){return this._html;}
    set textContent(value){this._text=String(value);this._html='';this.children=[];}
    get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.map(child=>child.textContent).join('');}
    appendChild(child){this.children.push(child);child.parentElement=this;return child;}
    addEventListener(name,handler){this.listeners[name]=handler;}
    setAttribute(name,value){this.attributes[name]=String(value);}
    querySelectorAll(){return [];}
    querySelector(selector){return this.children.find(child=>child.tagName===selector)||null;}
    click(){if(!this.disabled)this.listeners.click?.();}
  }
  const elements={},get=id=>elements[id]||(elements[id]=new Element());
  const document={getElementById:get,createElement:tag=>new Element(tag),body:new Element('body'),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
  const context=vm.createContext({console,document,window:{},localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},confirm:()=>true});
  const scripts=real?[...fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^\"]*)?"/g)].map(match=>match[1]).filter(file=>file.startsWith('js/')&&!/runtime|map\.js|ui\.js|main\.js|tutorial|world-news|global-overview/.test(file)):['data.js','data_world.js','data_provinces.js','campaign.js','game.js'].map(file=>'js/'+file);
  for(const file of scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  const Game=vm.runInContext('Game',context);Game.init(real?(theater==='anshi_755'?'tang':'qing'):'ger',real?'neu':'fas',null,'standard',real?theater:'sandbox36');Game.state.theaterId=theater;
  if(!real){
  const types=vm.runInContext('UNIT_TYPES',context),techs=vm.runInContext('TECHS',context);
  const profiles={infantry:{name:'步军',equip:7,res:9,oil:0,rare:0,role:'守备与推进'},cavalry:{name:'骑兵'},artillery:{name:theater==='anshi_755'?'弓弩':'炮队'},navy:{name:'水师',oil:0,rare:0}};
  Game.unitDefinition=key=>({...types[key],...profiles[key]});
  Game.techDefinition=id=>({...techs.find(tech=>tech.id===id),name:({inf1:'步军操练',art1:theater==='anshi_755'?'弓弩制造':'炮队操练',nav1:'舟师战法',ind1:'工坊扩建'})[id],cat:({inf1:'步军',art1:theater==='anshi_755'?'弓弩':'炮队',nav1:'水师',ind1:'工坊'})[id],year:theater==='anshi_755'?755:1853,pre:[],desc:'主题军备发展'});
  context.HistoricalTheaters={has:id=>['taiping_1853','anshi_755'].includes(id),unitProfile:()=>null,allowedUnit:(_,key)=>Object.hasOwn(profiles,key),allowedTech:(_,id)=>['inf1','art1','nav1','ind1'].includes(id),preview:()=>({personnel:43210,ships:8,composition:{infantry:4}})};
  const factionDefinitions=factions||[{id:'qing',name:'清廷',color:'#ddb855',capital:'chn_beijing',capitalLocation:{lon:116.4,lat:39.9}},{id:'taiping',name:'太平天国',color:'#b95555',capital:'chn_nanjing',capitalLocation:{lon:118.8,lat:32.06}}];
  context.HistoricalTheaters.countryProfile=(_,id)=>factionDefinitions.find(faction=>faction.id===id)||null;
  const entries=[{id:'ww1_1914',name:'1914 · 第一次世界大战'},{id:'sandbox36',name:'1936 · 第二次世界大战'},{id:'taiping_1853',name:'1853 · 太平天国'},{id:'anshi_755',name:'755 · 安史之乱'}];
  vm.runInContext('SCENARIOS.push(...'+JSON.stringify(entries.filter(entry=>!['sandbox36'].includes(entry.id)))+')',context);
  context.ScenarioSetup={allowedUnit:()=>true,techProfile:(_,id)=>Game.techDefinition(id),unitYear:()=>Game.state.theaterId==='anshi_755'?755:1853,techYear:()=>Game.state.theaterId==='anshi_755'?755:1853,entries:()=>entries,countries:id=>context.HistoricalTheaters.has(id)?factionDefinitions:vm.runInContext('COUNTRIES',context)};
  context.OrderOfBattle={preview:()=>({personnel:9000000,tanks:5000,aircraft:4000})};
  }
  context.MapView={setSelect:()=>{},isProvinceInView:()=>true,focusProvince:()=>{},showBattlePlan:()=>{},showAttackable:()=>{},clearAttackable:()=>{}};
  const source=fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { mapHandlers,renderRightPanel,renderOngoingBattle,unitGlyph,renderProvinceView,renderCountryOverview,renderProductionView,renderUnitTraining,renderResearchView,renderForceMetrics,renderCompositionControls,renderTopbar,initStartScreen,renderAutoEquipment,renderLogisticsView,init,refresh,');
  vm.runInContext(source,context);const UI=vm.runInContext('UI',context);context.window.UI=UI;
  const descendants=element=>[element,...element.children.flatMap(descendants)];
  get('eventModal').classList.add('hidden');
  return {Game,UI,get,context,descendants,Element};
}

test('historical theater force and dispatch controls omit nonexistent modern equipment',()=>{
  const {UI,Element}=setup();const metrics=UI.renderForceMetrics({personnel:43210,tanks:0,aircraft:0,ships:8},true);
  assert.deepEqual(metrics.children.map(child=>child.dataset.asset),['personnel','ships']);
  const parent=new Element();UI.renderCompositionControls(parent,{tankGroups:0,maxAircraft:0},{tankUnits:null,aircraftCount:null},()=>{});
  assert.equal(parent.children.length,0);
});

test('medieval ranged troops show a bow glyph without changing modern artillery icons',()=>{
  const {UI,context,Game}=setup('anshi_755'),modern=vm.runInContext('UNIT_GLYPH.artillery',context);
  assert.ok(!UI.unitGlyph('artillery').includes(modern));
  delete Game.state.theaterId;assert.ok(UI.unitGlyph('artillery').includes(modern));
});

test('historical training offers four era branches with effective names and costs',()=>{
  const {UI,Element,descendants}=setup();const panel=new Element();UI.renderUnitTraining(panel);
  const tabs=descendants(panel).find(element=>element.attributes['aria-label']==='训练军种');
  assert.deepEqual(tabs.children.map(child=>child.textContent),['步军','骑兵','炮队','水师']);
  assert.match(panel.textContent,/训练 步军/);assert.match(panel.textContent,/7军械/);assert.match(panel.textContent,/9粮草/);
  assert.doesNotMatch(panel.textContent,/坦克|飞机|石油|钢铁|潜艇|航母/);
  const options=descendants(panel).filter(element=>element.tagName==='option').map(element=>element.value);
  assert.deepEqual(options,['infantry','cavalry','artillery','navy']);
});

test('historical research uses era profiles and does not expose modern branches',()=>{
  const {UI,Element}=setup('anshi_755');const panel=new Element();UI.renderResearchView(panel);
  assert.match(panel.textContent,/步军操练/);assert.match(panel.textContent,/弓弩/);assert.match(panel.textContent,/水师/);
  assert.doesNotMatch(panel.textContent,/坦克|飞机|机械化|航空|航母|步兵战术 I/);
});

test('historical core army page and reserve recruitment do not reintroduce modern branches',()=>{
  const {UI,Element}=setup();const panel=new Element();UI.renderProductionView(panel);
  assert.doesNotMatch(panel.textContent,/坦克|飞机|空军|机械化|航母|石油/);
});

test('historical ongoing battle keeps genuine cavalry and ranged frontline effects visible without modern zero cards',()=>{
  const {UI,Element}=setup('anshi_755'),panel=new Element();
  UI.renderOngoingBattle(panel,[{id:'history-battle',name:'洛阳',to:0,playerSide:'attack',attacker:'ger',defender:'fra',phase:'engagement',days:3,progress:12,supply:80,tactics:'balanced',canRetreat:true,
    attackers:3,defenders:2,aOrg:75,dOrg:70,aPersonnel:30000,dPersonnel:20000,aPersonnelLoss:100,dPersonnelLoss:200,aAssets:{},dAssets:{},
    aEffects:{summary:'骑兵 1,000 人 · 弓弩 2,000 人',engagedCavalryPersonnel:1000,engagedArtilleryPersonnel:2000}}]);
  assert.match(panel.textContent,/骑兵 1,000 人 · 弓弩 2,000 人/);assert.doesNotMatch(panel.textContent,/坦克|飞机|累计出动/);
});

test('topbar hides modern asset chips for themes and restores them for world wars',()=>{
  const {UI,get,Element,Game}=setup();
  for(const [id,label]of [['tbTanks','坦克'],['tbAircraft','飞机'],['tbShips','舰艇'],['tbEquip','通用装备']]){const chip=new Element();const caption=new Element('span');caption.textContent=label;chip.appendChild(caption);chip.appendChild(get(id));}
  UI.renderTopbar();assert.equal(get('tbTanks').parentElement.hidden,true);assert.equal(get('tbAircraft').parentElement.hidden,true);assert.equal(get('tbShips').parentElement.children[0].textContent,'水师');assert.equal(get('tbEquip').parentElement.children[0].textContent,'军械');assert.equal(get('mapRegionSelector').hidden,true);
  delete Game.state.theaterId;UI.renderTopbar();assert.equal(get('tbTanks').parentElement.hidden,false);assert.equal(get('tbAircraft').parentElement.hidden,false);assert.equal(get('tbShips').parentElement.children[0].textContent,'舰艇');assert.equal(get('mapRegionSelector').hidden,false);
});

test('homepage theme choices use the theme army preview rather than modern order of battle',()=>{
  const {UI,get}=setup();UI.initStartScreen();const scenarios=get('selScenario');assert.equal(scenarios.children.length,4);
  scenarios.value='taiping_1853';scenarios.listeners.change();
  assert.equal(get('selCountry').children.length,2);assert.match(get('countryPreview').textContent,/4\.3 万人/);
  assert.doesNotMatch(get('countryPreview').textContent,/900\.0|坦克|飞机|增强兵力/);
  assert.match(get('scenDesc').textContent,/战略近似/);
});

test('multi-faction themes expose every faction and explain initial coalitions without claiming independent states',()=>{
  const factions=[
    {id:'qing',name:'清廷',color:'#5276c0',role:'正规军充足，战线分散',allies:['xiang'],enemies:['taiping','nian']},
    {id:'taiping',name:'太平天国',color:'#d26b38',role:'兵力集中，物资有限',allies:['nian'],enemies:['qing','xiang']},
    {id:'xiang',name:'湘军',color:'#749850',role:'沿江守备，稳健推进',allies:['qing'],enemies:['taiping']},
    {id:'nian',name:'捻军',color:'#a16bad',role:'机动袭扰，缺少守军',allies:[],enemies:['qing']}
  ];
  const {UI,get,descendants}=setup('taiping_1853',false,factions);UI.initStartScreen();const scenario=get('selScenario');scenario.value='taiping_1853';scenario.listeners.change();
  assert.equal(get('selCountry').children.length,4);assert.equal(get('countryChoices').children.length,4);assert.match(get('scenDesc').textContent,/4 方军政势力/);assert.doesNotMatch(get('scenDesc').textContent,/双方|两方/);
  for(const faction of factions){
    get('selCountry').value=faction.id;get('selCountry').listeners.change();const preview=get('countryPreview');
    assert.match(preview.textContent,new RegExp(faction.role));assert.match(preview.textContent,/军政势力/);
    const allies=descendants(preview).find(element=>element.className==='cp-initial-allies'),enemies=descendants(preview).find(element=>element.className==='cp-initial-enemies');
    assert.equal(allies.textContent,'初始盟友 · '+(faction.allies.map(id=>factions.find(candidate=>candidate.id===id).name).join('、')||'暂无'));
    assert.equal(enemies.textContent,'初始敌手 · '+faction.enemies.map(id=>factions.find(candidate=>candidate.id===id).name).join('、'));
    assert.doesNotMatch(preview.textContent,/独立主权国家|坦克|飞机/);
  }
});

test('historical theater map reset fits the complete theater rather than the world',()=>{
  const source=fs.readFileSync(path.join(__dirname,'map-orders.test.cjs'),'utf8');
  const fixture=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+';return setup;')(require,__dirname);
  const context=fixture();context.Game.state.provinces.forEach((province,index)=>{province.x=650+index*10;province.y=150+index*3;});context.Game.state.theaterId='taiping_1853';context.map.resetView();
  assert.ok(context.map.getK()>1);
  context.map.focusPlayer();context.advance(1000);while(context.runFrame()){}
  assert.ok(context.map.isProvinceInView(5,0),'theater focus includes an opposing end of the theater');
});

test('outside theater country backgrounds are muted and return to world styling after switching campaigns',()=>{
  const source=fs.readFileSync(path.join(__dirname,'map-orders.test.cjs'),'utf8');
  const fixture=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+';return setup;')(require,__dirname);
  const context=fixture();context.WORLD_HISTORICAL_MAP.shapes.push({id:'chn',d:''},{id:'fra',d:''});context.Game.state.theaterId='taiping_1853';
  context.Game.state.provinces.forEach(province=>{province.shapeOwner='chn';});context.map.render();
  const outside=context.layers.get('layerCountryFills').children[1];assert.match(outside.attrs.class,/theater-muted/);
  assert.ok(context.layers.get('layerTerritory').children.every(node=>node.attrs.class.includes('theater-control')));
  delete context.Game.state.theaterId;context.map.render();assert.doesNotMatch(context.layers.get('layerCountryFills').children[1].attrs.class,/theater-muted/);assert.ok(context.layers.get('layerTerritory').children.every(node=>!node.attrs.class.includes('theater-control')));
});

test('both actual historical scenario states render useful training and research without modern equipment',()=>{
  for(const theater of ['taiping_1853','anshi_755']){
    const {UI,Game,Element,descendants}=setup(theater,true);assert.equal(Game.state.scenario,theater);
    const army=new Element();UI.renderProductionView(army);
    assert.match(army.textContent,/训练 步/);assert.doesNotMatch(army.textContent,/坦克|飞机|空军|机械化|石油|钢铁/);
    const training=descendants(army).find(element=>element.attributes['aria-label']==='选择训练兵种');assert.ok(training.children.length>0);
    const research=new Element();UI.renderResearchView(research);assert.match(research.textContent,/步军操练/);assert.doesNotMatch(research.textContent,/坦克|飞机|航空|航母|工业/);
    Game.state.selectedIdx=Game.country(Game.state.player).capitalIdx;const details=new Element();UI.renderProvinceView(details);assert.doesNotMatch(details.textContent,/飞机|石油|步兵师|装甲师/);
    Game.state.selectedIdx=Game.state.provinces.findIndex(province=>province.owner!==Game.state.player);const enemyDetails=new Element();UI.renderProvinceView(enemyDetails);assert.doesNotMatch(enemyDetails.textContent,/轰炸/);
    const overview=new Element();UI.renderCountryOverview(overview);assert.doesNotMatch(overview.textContent,/石油|钢铁|工厂/);
    Game.init('ger','fas',null,'standard','sandbox36');const worldResearch=new Element();UI.renderResearchView(worldResearch);assert.match(worldResearch.textContent,/步兵战术 I/);
  }
});

function labelPointerFixture(pointers=true){
  const source=fs.readFileSync(path.join(__dirname,'map-pointer.test.cjs'),'utf8');
  const factory=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+';return setup;')(require,__dirname);
  const fixture=factory(pointers);fixture.map.setTutorialFocus(1);fixture.map.render();
  const label=()=>fixture.layers.get('layerLabels').children.find(node=>node.attrs.class?.includes('density-city-label')&&node.textContent==='Target');
  const target=label();assert.ok(target);target.closest=selector=>selector.includes('[data-province-index]')||selector.includes('[role="button"]')?target:null;
  return {...fixture,label,target};
}

test('decluttered province labels target their own province through pointer refresh and keyboard activation',()=>{
  for(const pointers of [true,false]){
    const fixture=labelPointerFixture(pointers),{target}=fixture;
    assert.equal(target.attrs['data-province-index'],'1');assert.equal(target.attrs.role,'button');
    fixture.fire(fixture.wrap,pointers?'pointerdown':'mousedown',{target,clientX:500});fixture.map.render();
    fixture.fire(fixture.window,pointers?'pointerup':'mouseup',{clientX:500});assert.deepEqual(fixture.selected,[1]);
    fixture.fire(fixture.label(),'click',{detail:1});assert.deepEqual(fixture.selected,[1]);
    fixture.fire(fixture.label(),'keydown',{key:'Enter',detail:0});assert.deepEqual(fixture.selected,[1,1]);
  }
});

test('dragged and cancelled label taps cannot issue an order through a compatibility click',()=>{
  for(const cancel of [true,false]){
    const fixture=labelPointerFixture();fixture.fire(fixture.wrap,'pointerdown',{target:fixture.target});
    if(cancel)fixture.fire(fixture.window,'pointercancel');else{fixture.fire(fixture.window,'pointermove',{clientX:535});fixture.fire(fixture.window,'pointerup',{clientX:535});}
    fixture.fire(fixture.label(),'click',{detail:1});assert.deepEqual(fixture.selected,[]);
  }
});

test('tutorial focused province name remains visible and clickable ahead of nearby army counters',()=>{
  const source=fs.readFileSync(path.join(__dirname,'map-orders.test.cjs'),'utf8');
  const factory=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+';return setup;')(require,__dirname),context=factory();
  for(let count=0;count<4;count++)context.map.zoomIn();const zoom=context.map.getK();
  context.Game.state.provinces.forEach((province,index)=>{province.owner='ger';province.x=500;province.y=index===0?250-32/zoom:250;province.garrison=index<2?[{type:'infantry',hp:100,maxHp:100,people:40000}]:[];province.isCapital=index===0;});
  context.map.setTutorialFocus(1);context.map.render();
  const label=context.layers.get('layerLabels').children.find(node=>node.textContent==='b'&&node.attrs.class?.includes('density-city-label'));
  assert.ok(label,'the requested tutorial province must not be suppressed by army counters');assert.equal(label.attrs['data-province-index'],'1');assert.equal(label.attrs.role,'button');
});

test('choosing a genuine attack target leaves only the origin hint and cancellation on the map',()=>{
  for(const [scenario,player]of [['anshi_755','anshi'],['sandbox36','ger']]){
    const {UI,Game,get,descendants}=setup('anshi_755',true);Game.init(player,'neu',null,'standard',scenario);
    const origin=Game.state.provinces.findIndex((province,index)=>province.owner===player&&Game.landCount(index)&&Game.landTargets(index).some(target=>Game.province(target).owner!==player&&!Game.isAllied(player,Game.province(target).owner)));
    assert.ok(origin>=0);get('startScreen').classList.add('hidden');UI.mapHandlers().provinceClick(origin);
    const dispatch=descendants(get('rpContent')).find(element=>element.tagName==='button'&&element.textContent==='出征');assert.ok(dispatch);dispatch.click();
    const panel=get('rpContent'),selection=descendants(panel).find(element=>element.className==='attack-target-selection');
    assert.ok(selection,'target selection must replace the source city card');assert.match(selection.textContent,new RegExp(Game.province(origin).cityName||Game.province(origin).name));assert.match(selection.textContent,/选择进攻目标/);
    assert.deepEqual(descendants(panel).filter(element=>element.tagName==='button').map(element=>element.textContent),['取消命令']);
    assert.equal(descendants(panel).some(element=>element.className==='city-card'),false);
    assert.equal(Game.state.selectedIdx,origin,'entering target mode must not select a target automatically');assert.equal(Game.state.activeCombats.length,0);
    UI.refresh();assert.ok(descendants(panel).some(element=>element.className==='attack-target-selection'));
    descendants(panel).find(element=>element.tagName==='button').click();
    assert.ok(descendants(panel).some(element=>element.className==='city-card'));assert.equal(Game.state.selectedIdx,origin);
  }
});

test('target focus avoids the command and tutorial cards in portrait and landscape',()=>{
  const source=fs.readFileSync(path.join(__dirname,'map-pointer.test.cjs'),'utf8');
  const factory=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+';return setup;')(require,__dirname),fixture=factory();
  fixture.Game.state.selectedIdx=1;
  for(const [width,height,top,panel,tutorial]of [
    [390,844,116,{left:12,right:378,top:484,bottom:614,width:366,height:130},{left:12,right:378,top:624,bottom:760,width:366,height:136}],
    [844,390,64,{left:486,right:826,top:82,bottom:212,width:340,height:130},{left:12,right:464,top:164,bottom:304,width:452,height:140}]
  ]){
    fixture.resize(width,height-top);Object.assign(fixture.wrap.getBoundingClientRect(),{top,bottom:height});
    fixture.layers.set('rightPanel',{classList:{contains:()=>false},getBoundingClientRect:()=>panel});
    fixture.layers.set('warTutorial',{hidden:false,getBoundingClientRect:()=>tutorial});
    fixture.map.focusProvince(1,false);
    const camera=fixture.map.getCamera(),bounds=fixture.wrap.getBoundingClientRect(),zoom=camera.scale*Math.min(bounds.width/1000,bounds.height/500),province=fixture.Game.state.provinces[1];
    const point={x:bounds.left+bounds.width/2+camera.panX+zoom*(province.x-500),y:bounds.top+bounds.height/2+camera.panY+zoom*(province.y-250)};
    for(const [label,rectangle]of [['command',panel],['tutorial',tutorial]])assert.ok(point.x+26<rectangle.left||point.x-26>rectangle.right||point.y+26<rectangle.top||point.y-26>rectangle.bottom,`${width}x${height} province label must clear ${label}`);
    assert.equal(fixture.map.isProvinceInView(1),true);
  }
});

test('planning and ongoing battles keep every tactic inside the same core command area as execution',()=>{
  const {UI,Game,get,descendants}=setup('anshi_755',true);Game.init('anshi','neu',null,'standard','anshi_755');
  get('startScreen').classList.add('hidden');
  const origin=Game.state.provinces.findIndex(province=>province.cityName==='范阳'||province.name==='范阳');assert.ok(origin>=0);
  const target=Game.landTargets(origin).find(index=>Game.province(index).owner!=='anshi'&&!Game.isAllied('anshi',Game.province(index).owner));assert.ok(target>=0);
  UI.mapHandlers().provinceClick(origin);descendants(get('rpContent')).find(element=>element.tagName==='button'&&element.textContent==='出征').click();UI.mapHandlers().provinceClick(target);
  let panel=get('rpContent'),commands=descendants(panel).find(element=>element.className==='battle-primary-orders');
  assert.ok(commands,'planning tactics must share an always reachable core area with confirmation');
  assert.deepEqual(descendants(commands).filter(element=>element.className==='combat-tactic-choice').map(element=>element.textContent),['谨慎','均衡','强攻']);
  assert.ok(descendants(commands).some(element=>element.textContent==='确认进攻'));assert.ok(descendants(commands).some(element=>element.textContent==='取消命令'));
  descendants(commands).find(element=>element.attributes['aria-label']==='选择强攻战术').click();
  descendants(get('rpContent')).find(element=>element.tagName==='button'&&element.textContent==='确认进攻').click();
  const combat=Game.getCombats().find(battle=>battle.to===target);assert.ok(combat);assert.equal(combat.tactics,'assault');
  commands=descendants(get('rpContent')).find(element=>element.className==='combat-primary-orders');assert.ok(commands,'ongoing tactics must stay with pause, reinforcement and retreat');
  assert.deepEqual(descendants(commands).filter(element=>element.className==='combat-tactic-choice').map(element=>element.textContent),['谨慎','均衡','强攻']);
  for(const name of ['暂停布置','增援','撤退'])assert.ok(descendants(commands).some(element=>element.tagName==='button'&&element.textContent===name),name);
  descendants(commands).find(element=>element.attributes['aria-label']==='谨慎战术').click();assert.equal(Game.getCombat(combat.id).tactics,'careful');
});
