const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  class Element{
    constructor(){this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(name,force)=>force?this.classes.add(name):this.classes.delete(name)};}
    set innerHTML(v){this.children=[];this.html=v;}
    setAttribute(k,v){this.attrs[k]=v;}
    appendChild(e){this.children.push(e);return e;}
    addEventListener(k,f){this.listeners[k]=f;}
  }
  const box=new Element(),modal=new Element(),body=new Element(),unrest=new Element();modal.classList.add('hidden');body.classList.add('playing');unrest.classList.add('hidden');
  const timers=new Map(),focused=[],selected=[];let serial=0;
  const ctx=vm.createContext({document:{body,getElementById:id=>id==='worldNews'?box:id==='worldUnrest'?unrest:id==='eventModal'?modal:null,createElement:()=>new Element()},
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),MapView:{focusProvince:i=>focused.push(i)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8')+'\nthis.news=WorldNews;',ctx);
  const state={player:'ger',worldEventSerial:0,worldEvents:[]};ctx.news.reset(state);
  const event=(kind='capture',countryIds=['ger','pol'],priority=2)=>{const e={id:'e'+(++state.worldEventSerial),kind,countryIds,priority,day:'1939-09-10',title:'实际战果 '+state.worldEventSerial,detail:'世界发生了变化',provinceIdx:4};state.worldEvents.push(e);return e;};
  const update=()=>ctx.news.update(state,i=>selected.push(i));
  const close=()=>box.children.find(e=>e.attrs['aria-label']==='关闭重点事件').listeners.click();
  const tick=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
  return {news:ctx.news,state,box,modal,body,unrest,timers,focused,selected,event,update,close,tick,ctx};
}

test('acknowledging defense alerts clears the card without starting any simulation clock',()=>{
  const f=setup();let resumes=0,saves=0,refreshes=0;f.ctx.UI={resumeSpeed:()=>resumes++,focusCombat:()=>true,refresh:()=>{refreshes++;assert.equal(f.box.classList.contains('hidden'),true,'refresh receives a cleared card');f.update();}};f.ctx.Game={autosave:()=>saves++};
  const a=f.event('invasion'),b=f.event('invasion');a.acknowledged=b.acknowledged=false;f.update();
  const acknowledge=()=>f.box.children.find(e=>e.className==='news-close').listeners.click();
  acknowledge();assert.equal(a.acknowledged,true);assert.equal(resumes,0,'other alerts still block time');
  acknowledge();assert.equal(b.acknowledged,true);assert.equal(resumes,0);assert.equal(saves,2);assert.equal(refreshes,2);
  assert.equal(f.box.children.length,0);assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.timers.size,0);
  f.update();assert.equal(resumes,0,'refresh cannot start another clock');
  const c=f.event('invasion');c.acknowledged=false;f.update();f.box.children.find(e=>e.className==='news-locate').listeners.click();
  assert.equal(c.acknowledged,true);assert.equal(resumes,0,'view battlefield is a planning action');
});

test('acknowledgment refresh respects another unread alert covered by a required event',()=>{
  const f=setup(),a=f.event('invasion'),b=f.event('invasion');f.ctx.UI={refresh:()=>f.update()};f.update();
  f.modal.classList.remove('hidden');f.box.children.find(e=>e.className==='news-close').listeners.click();
  assert.equal(a.acknowledged,true);assert.notEqual(b.acknowledged,true);assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.box.children.length,0);assert.equal(f.timers.size,0);
  f.modal.classList.add('hidden');f.update();assert.equal(f.box.dataset.event,b.id);assert.equal(f.timers.size,0);
});

test('world news groups a batch into a single brief digest and never replays it',()=>{
  const f=setup();f.event('war',['fra','ita'],3);const player=f.event('capture');f.update();
  assert.equal(f.box.dataset.event,player.id);assert.equal(f.timers.size,1);
  f.update();f.update();assert.equal(f.timers.size,1);
  assert.match(f.box.children.find(e=>e.className==='news-title').textContent,/另 1 条/);
  f.close();assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.timers.size,0);assert.equal(f.box.children.length,0);
  f.update();assert.equal(f.box.classList.contains('hidden'),true);
});

test('dozens of same-day events use one lifetime, while unread defense alerts remain persistent',()=>{
  const f=setup();for(let i=0;i<35;i++)f.event('war',['fra','ita'],3);f.update();
  assert.equal(f.timers.size,1);assert.match(f.box.children.find(e=>e.className==='news-detail').textContent,/35 条/);
  f.event('capture');f.update();assert.equal(f.timers.size,1,'new messages do not extend the active timer');
  f.tick();assert.equal(f.box.children.length,0);f.update();assert.equal(f.box.classList.contains('hidden'),true);
  const alert=f.event('invasion');f.update();assert.equal(f.timers.size,0);f.update();assert.equal(f.box.dataset.event,alert.id);
  f.news.reset(f.state);f.update();assert.equal(f.box.dataset.event,alert.id,'loaded unread alerts remain visible');
});

test('required choice pauses news lifetime, then resumes without dropping the covered event',()=>{
  const f=setup();f.event();f.update();f.modal.classList.remove('hidden');f.update();
  assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.timers.size,0);
  f.modal.classList.add('hidden');f.update();assert.equal(f.box.dataset.event,'e1');
  assert.equal(f.box.classList.contains('hidden'),false);assert.equal(f.timers.size,1);
  f.box.children.find(e=>e.className==='news-locate').listeners.click();
  assert.deepEqual(f.focused,[4]);assert.deepEqual(f.selected,[4]);assert.equal(f.timers.size,0);
});

test('loaded games do not replay old events and returning home clears queued cards and timers',()=>{
  const f=setup();f.event();f.news.reset(f.state);f.update();assert.equal(f.timers.size,0);
  f.event();f.update();assert.equal(f.box.dataset.event,'e2');
  f.news.reset();assert.equal(f.timers.size,0);assert.equal(f.box.children.length,0);assert.equal(f.box.classList.contains('hidden'),true);
});

test('foreign civil wars remain locatable after the transient news disappears and clear only after actual peace',()=>{
  const f=setup();Object.assign(f.state,{countries:{esp:{alive:true,name:'西班牙'},rebels:{alive:true,name:'反对派'}},
    provinces:[{owner:'esp'},{owner:'rebels'}],wars:[{a:'esp',b:'rebels'}],unrest:{conflicts:[{parent:'esp',rebels:'rebels',kind:'civilWar'}]}});
  f.event('war',['esp','rebels'],3);f.update();assert.equal(f.unrest.classList.contains('hidden'),false);assert.match(f.unrest.textContent,/西班牙内战/);
  f.tick();assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.unrest.classList.contains('hidden'),false);
  f.unrest.onclick();assert.deepEqual(f.focused,[1]);assert.deepEqual(f.selected,[1]);
  f.state.wars=[];f.update();assert.equal(f.unrest.classList.contains('hidden'),true);assert.equal(f.unrest.textContent,'');
});
