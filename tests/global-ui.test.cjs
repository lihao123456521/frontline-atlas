const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(){
  class Element{
    constructor(){this.value='';this.children=[];this.listeners={};this.style={};this.dataset={};this.attributes={};}
    appendChild(e){this.children.push(e);if(!this.value&&e.value)this.value=e.value;return e;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    setAttribute(k,v){this.attributes[k]=String(v);}
    change(value){this.value=value;this.listeners.change();}
    click(){this.listeners.click();}
    set textContent(value){this.text=String(value);this.children=[];}
  }
  const elements={},created=[];const get=id=>elements[id]||(elements[id]=new Element());
  get('selDifficulty').value='standard';
  const calls=[];
  const ctx=vm.createContext({console,document:{getElementById:get,createElement:()=>{const e=new Element();created.push(e);return e;},querySelectorAll:selector=>selector==='.country-choice'?created.filter(e=>e.className==='country-choice'):[]},
    Game:{state:null,hasSave:()=>false},
    MapView:{zoomIn:()=>calls.push('in'),zoomOut:()=>calls.push('out'),resetView:()=>calls.push('global'),focusPlayer:()=>calls.push('player'),focusRegion:key=>calls.push(key)},
    COUNTRIES:[{id:'ger',name:'德国',color:'#333',ideo:'fas'},{id:'jpn',name:'日本',color:'#444',ideo:'fas'},{id:'usa',name:'美国',color:'#555',ideo:'dem'}],
    MINOR_COUNTRIES:[{id:'bra',name:'巴西',color:'#666',ideo:'neu'}],
    PLAYABLE_COUNTRIES:['ger','jpn','usa','bra'],
    PROVINCES_DEF:[],
    SCENARIOS:[{id:'sandbox36',name:'全球沙盒',player:null},{id:'pacific42',name:'太平洋战争',player:'jpn'},{id:'bad',player:'unsupported'}],
    DIFFICULTY:{standard:{desc:'标准'}},
  });
  // Expose existing private DOM setup to run its real listeners without a browser.
  const source=fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { initStartScreen, bindMapNavigation, init, refresh,');
  vm.runInContext(source,ctx);return {UI:vm.runInContext('UI',ctx),get,calls};
}
test('the lightweight homepage fallback keeps global countries free and hides legacy fixed campaigns',()=>{
  const {UI,get}=setup();UI.initStartScreen();
  assert.deepEqual(get('selCountry').children.map(e=>e.value),['ger','jpn','usa','bra']);
  assert.deepEqual(get('selScenario').children.map(e=>e.value),['sandbox36']);
  assert.equal(get('selCountry').value,'ger');assert.equal(get('selCountry').disabled,false);
  get('selCountry').change('jpn');assert.equal(get('selCountry').value,'jpn');assert.equal(get('selCountry').disabled,false);
  get('selScenario').change('sandbox36');assert.equal(get('selCountry').value,'jpn');assert.equal(get('selCountry').disabled,false);
});
test('region selector dispatches each region and global/player controls without advancing gameplay',()=>{
  const {UI,get,calls}=setup();UI.bindMapNavigation();
  for(const region of ['europe','asia','americas','africa','pacific','global'])get('mapRegionSelector').change(region);
  get('mapFocusPlayer').click();assert.equal(get('mapRegionSelector').value,'');
  get('zoomReset').click();assert.equal(get('mapRegionSelector').value,'global');
  get('zoomIn').click();get('zoomOut').click();
  assert.deepEqual(calls,['europe','asia','americas','africa','pacific','global','player','global','in','out']);
});
