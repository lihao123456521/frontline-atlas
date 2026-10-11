const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  class Element{
    constructor(){this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x)};}
    set innerHTML(v){this.children=[];this.html=v;}
    setAttribute(k,v){this.attrs[k]=v;}
    appendChild(e){this.children.push(e);return e;}
    addEventListener(k,f){this.listeners[k]=f;}
  }
  const box=new Element(),modal=new Element(),body=new Element();modal.classList.add('hidden');body.classList.add('playing');
  const timers=new Map(),focused=[],selected=[];let serial=0;
  const ctx=vm.createContext({document:{body,getElementById:id=>id==='worldNews'?box:modal,createElement:()=>new Element()},
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),MapView:{focusProvince:i=>focused.push(i)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/world-news.js'),'utf8')+'\nthis.news=WorldNews;',ctx);
  const state={player:'ger',worldEventSerial:0,worldEvents:[]};ctx.news.reset(state);
  const event=(kind='capture',countryIds=['ger','pol'],priority=2)=>{const e={id:'e'+(++state.worldEventSerial),kind,countryIds,priority,day:'1939-09-10',title:'实际战果 '+state.worldEventSerial,detail:'世界发生了变化',provinceIdx:4};state.worldEvents.push(e);return e;};
  const update=()=>ctx.news.update(state,i=>selected.push(i));
  const close=()=>box.children.find(e=>e.attrs['aria-label']==='关闭重点事件').listeners.click();
  const tick=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
  return {news:ctx.news,state,box,modal,body,timers,focused,selected,event,update,close,tick};
}

test('world news deduplicates refresh, prioritizes player outcomes and advances one card at a time',()=>{
  const f=setup();f.event('war',['fra','ita'],3);const player=f.event('capture');f.update();
  assert.equal(f.box.dataset.event,player.id);assert.equal(f.timers.size,1);
  f.update();f.update();assert.equal(f.timers.size,1);
  f.close();assert.equal(f.box.dataset.event,'e1');assert.equal(f.timers.size,1);
  f.tick();assert.equal(f.box.classList.contains('hidden'),true);assert.equal(f.timers.size,0);
  f.update();assert.equal(f.box.classList.contains('hidden'),true);
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
