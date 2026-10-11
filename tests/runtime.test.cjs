const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function setup(){
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.textContent='';}
    appendChild(child){this.children.push(child);return child;}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(type,fn){this.listeners[type]=fn;}
  }
  const listeners={},body=new Element('body'),logs=[];let reloads=0;
  const context=vm.createContext({
    console:{error:(...args)=>logs.push(args)},
    document:{body,createElement:tag=>new Element(tag)},
    window:{location:{reload(){reloads++;}},addEventListener(type,fn){(listeners[type]||(listeners[type]=[])).push(fn);}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'js/runtime.js'),'utf8'),context);
  const emit=(type,event)=>listeners[type]?.forEach(fn=>fn(event));
  return {context,body,logs,emit,reloads:()=>reloads};
}
test('a failed early script retains the first cause and exposes one working reload control',()=>{
  const f=setup();f.emit('error',{target:{tagName:'SCRIPT',src:'/js/map.js?v=38'}});
  f.emit('error',{message:'MapView is not defined',filename:'/js/main.js',lineno:7});
  assert.equal(f.body.children.length,1);assert.equal(f.logs.length,1);
  const box=f.body.children[0];assert.equal(box.attributes.role,'alert');
  const details=box.children.find(e=>e.tagName==='details');assert.match(details.children[1].textContent,/map\.js.*文件未能载入/);
  const retry=box.children.find(e=>e.tagName==='button');assert.equal(retry.textContent,'重新加载');retry.listeners.click();assert.equal(f.reloads(),1);
  vm.runInContext(fs.readFileSync(path.join(root,'js/main.js'),'utf8'),f.context);
  assert.doesNotThrow(()=>f.emit('DOMContentLoaded',{}));
});
test('startup with missing modules reports a useful failure without throwing a secondary reference error',()=>{
  const f=setup();vm.runInContext(fs.readFileSync(path.join(root,'js/main.js'),'utf8'),f.context);
  assert.doesNotThrow(()=>f.emit('DOMContentLoaded',{}));
  assert.equal(f.body.children.length,1);assert.match(f.logs[0][2],/游戏、地图、界面、历史编制未能初始化/);
});
test('rejection recovery captures the real reason and early diagnostics precede all game dependencies',()=>{
  const f=setup();f.context.window.HoiRuntime.ready();f.emit('unhandledrejection',{reason:{message:'example failure'}});
  assert.match(f.logs[0][2],/example failure/);assert.equal(f.body.children[0].children[0].textContent,'游戏遇到异常');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),runtime=html.indexOf('src="js/runtime.js');
  assert.ok(runtime>=0);for(const script of ['data.js','game.js','map.js','ui.js','main.js'])assert.ok(runtime<html.indexOf('src="js/'+script));
});
