const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  let document;
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c)};}
    set innerHTML(v){if(document&&this.contains(document.activeElement))document.activeElement=document.body;this.children=[];}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}
    appendChild(e){e.parent=this;this.children.push(e);return e;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}
    addEventListener(k,f){this.listeners[k]=f;}
    focus(){document.activeElement=this;}
    contains(element){return this===element||descendants(this).includes(element);}
    querySelector(selector){
      const data=selector.match(/^\[data-(country|filter)="([^"]+)"\]$/);
      return descendants(this).find(e=>data?e.dataset[data[1]]===data[2]:selector.startsWith('.')?(e.className||'').split(' ').includes(selector.slice(1)):e.tagName===selector);
    }
    querySelectorAll(){return descendants(this).filter(e=>['button','input','select'].includes(e.tagName)||e.attrs.tabindex==='0');}
  }
  const descendants=e=>e.children.flatMap(c=>[c,...descendants(c)]);
  const body=new Element('body');document={body,activeElement:null,createElement:t=>new Element(t),createElementNS:(ns,t)=>new Element(t),listeners:{},addEventListener(k,f){this.listeners[k]=f;},removeEventListener(k){delete this.listeners[k];}};
  const state={player:'ger',countries:{ger:{id:'ger',name:'德国',alive:true,equipment:40},fra:{id:'fra',name:'法国',alive:true,equipment:25},ita:{id:'ita',name:'意大利',alive:true,equipment:987654},usa:{id:'usa',name:'美国',alive:true,equipment:10},gone:{id:'gone',name:'已投降',alive:false}},provinces:[{owner:'ger',administrativeWeight:.5},{owner:'ger',administrativeWeight:.5},{owner:'fra',administrativeWeight:3},{owner:'ita',administrativeWeight:2}],wars:[{a:'fra',b:'ita'}],alliances:{'fra|ger':true,'ita|usa':true}};
  const key=(a,b)=>[a,b].sort().join('|'),queries=[],selections=[],focus=[];
  const Game={isAtWar:(a,b)=>{queries.push([a,b]);return state.wars.some(w=>key(w.a,w.b)===key(a,b));},isAllied:(a,b)=>!!state.alliances[key(a,b)],canSee:id=>id==='fra',armyTotals:id=>({personnel:id==='ger'?125000:75000})};
  const ctx=vm.createContext({document,Game,COUNTRIES:[state.countries.ger,state.countries.fra],console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/global-overview.js'),'utf8')+'\nthis.overview=WorldOverview;',ctx);
  const open=()=>ctx.overview.open(state,{onSelectCountry:id=>selections.push(id),onFocusCountry:id=>focus.push(id)}),all=()=>descendants(body),find=predicate=>all().find(predicate),clickText=t=>find(e=>e.tagName==='button'&&e.textContent===t).listeners.click();
  return {ctx,state,document,body,queries,selections,focus,open,all,find,clickText};
}

test('global overview includes AI-versus-AI wars and alliances, with independent filters',()=>{
  const f=setup();f.open();
  const edges=()=>f.all().filter(e=>e.tagName==='line');
  assert.ok(edges().some(e=>e.dataset.a==='fra'&&e.dataset.b==='ita'&&e.dataset.kind==='war'));
  assert.ok(edges().some(e=>e.dataset.a==='ita'&&e.dataset.b==='usa'&&e.dataset.kind==='ally'));
  const pairs=f.find(e=>e.className==='wo-pair-list');assert.equal(pairs.children.length,3,'default global list includes every war and alliance');
  assert.equal(pairs.children.filter(e=>e.className==='wo-pair ally').length,2);assert.ok(f.find(e=>e.tagName==='h3'&&e.textContent==='全球关系清单'));
  assert.ok(f.queries.some(([a,b])=>a==='fra'&&b==='ita'));
  f.clickText('只看战争');assert.ok(edges().length);assert.ok(edges().every(e=>e.dataset.kind==='war'));
  f.clickText('只看同盟');assert.ok(edges().every(e=>e.dataset.kind==='ally'));
  const text=f.all().map(e=>e.textContent||'').join(' ');assert.match(text,/4 个存续国家/);assert.doesNotMatch(text,/已投降/);
});

test('country focus and diplomacy buttons invoke actual callbacks without diplomacy side effects',()=>{
  const f=setup(),before=JSON.stringify(f.state);f.open();
  f.find(e=>e.tagName==='g'&&e.dataset.country==='ita').listeners.click();f.clickText('地图定位');assert.deepEqual(f.focus,['ita']);
  assert.equal(f.ctx.overview.isOpen,false);f.open();
  f.clickText('打开外交');assert.deepEqual(f.selections,['ita']);assert.equal(f.ctx.overview.isOpen,false);assert.equal(f.body.children.length,0);assert.equal(JSON.stringify(f.state),before);
});

test('unknown military/equipment is not read or disclosed, and search includes isolated countries',()=>{
  const f=setup();f.open();const text=f.all().map(e=>e.textContent||'').join(' ');assert.match(text,/情报不足/);assert.doesNotMatch(text,/987,654/);assert.match(text,/125,000 人/);
  const search=f.find(e=>e.tagName==='input');search.value='美国';search.listeners.input();const roster=f.find(e=>e.className==='wo-roster-list');assert.equal(roster.children.length,1);assert.match(roster.children[0].textContent,/美国/);
});

test('refresh and repeated open use one overlay; closing removes listeners and restores focus',()=>{
  const f=setup();const trigger={focus(){f.document.activeElement=this;}};f.document.activeElement=trigger;f.open();f.open();for(let i=0;i<4;i++)f.ctx.overview.refresh(f.state);assert.equal(f.body.children.length,1);
  f.document.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(f.body.children.length,0);assert.equal(f.document.listeners.keydown,undefined);assert.equal(f.document.activeElement,trigger);f.ctx.overview.refresh(f.state);assert.equal(f.body.children.length,0);
});

test('country selection and filter rebuild preserve focus inside the modal',()=>{
  const f=setup();f.open();const overlay=f.body.children[0],country=f.find(e=>e.tagName==='g'&&e.dataset.country==='ita');country.focus();country.listeners.click();
  assert.equal(overlay.contains(country),false,'the original focused node was actually removed');assert.equal(overlay.contains(f.document.activeElement),true);assert.equal(f.document.activeElement.dataset.country,'ita');
  const filter=f.find(e=>e.dataset.filter==='war');filter.focus();filter.listeners.click();
  assert.equal(overlay.contains(filter),false);assert.equal(overlay.contains(f.document.activeElement),true);assert.equal(f.document.activeElement.dataset.filter,'war');
  f.ctx.overview.refresh(f.state);assert.equal(overlay.contains(f.document.activeElement),true);assert.equal(f.document.activeElement.dataset.filter,'war');
});

test('Tab from body or a background control restores modal focus in both directions',()=>{
  const f=setup();f.open();const overlay=f.body.children[0],background=f.document.createElement('button');let advances=0;
  background.addEventListener('click',()=>advances++);f.body.appendChild(background);
  for(const outside of [f.body,background])for(const shiftKey of [false,true]){
    f.document.activeElement=outside;let prevented=false;f.document.listeners.keydown({key:'Tab',shiftKey,preventDefault(){prevented=true;}});
    assert.equal(prevented,true,'native Tab cannot continue to a background command');assert.equal(overlay.contains(f.document.activeElement),true);
    const controls=overlay.querySelectorAll();assert.equal(f.document.activeElement,shiftKey?controls.at(-1):controls[0]);
  }
  assert.equal(advances,0);const controls=overlay.querySelectorAll();controls[0].focus();f.document.listeners.keydown({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(f.document.activeElement,controls.at(-1));
  controls.at(-1).focus();f.document.listeners.keydown({key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(f.document.activeElement,controls[0]);
});
