const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
  const created=[];
  class Element{
    constructor(tag='div'){
      this.tagName=tag;this.value='';this.children=[];this.listeners={};this.style={};this.dataset={};this.attributes={};
    }
    appendChild(node){
      this.children.push(node);
      if(this.tagName==='select' && !this.value && node.value)this.value=node.value;
      return node;
    }
    setAttribute(name,value){this.attributes[name]=String(value);}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    change(value){if(this.disabled)return;this.value=value;for(const fn of this.listeners.change||[])fn({target:this});}
    click(){if(this.disabled)return;for(const fn of this.listeners.click||[])fn({target:this});}
    get textContent(){return (this.text||'')+(this.innerHTML||'').replace(/<[^>]*>/g,'')+this.children.map(n=>n.textContent).join('');}
    set textContent(value){this.text=String(value);this.innerHTML='';this.children=[];}
  }
  const elements={},selects=new Set(['selCountry','selScenario','selDifficulty']);
  const get=id=>elements[id]||=(new Element(selects.has(id)?'select':'div'));
  get('selDifficulty').value='standard';
  const context=vm.createContext({console,document:{
    getElementById:get,
    createElement:tag=>{const node=new Element(tag);created.push(node);return node;},
    querySelectorAll:selector=>selector==='.country-choice'?created.filter(n=>n.className==='country-choice'):[],
  },Game:{state:null,hasSave:()=>false}});
  for(const file of ['data.js','data_world.js','data_provinces.js','data_historical_map.js','data_world_historical.js','history.js','world.js',...(fs.existsSync(path.join(__dirname,'../js/campaign_eras.js'))?['campaign_eras.js']:[]),'order_of_battle.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context,{filename:file});
  }
  const source=fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8').replace('return { init, refresh,','return { initStartScreen, init, refresh,');
  vm.runInContext(source,context,{filename:'ui.js'});
  const UI=vm.runInContext('UI',context);
  const data=vm.runInContext('({tables:OrderOfBattle.tables,opening:OrderOfBattle.preview,countries:COUNTRIES.concat(MINOR_COUNTRIES),playable:PLAYABLE_COUNTRIES,scenarios:SCENARIOS})',context);
  UI.initStartScreen();
  const countryButton=id=>get('countryChoices').children.find(n=>n.dataset.country===id);
  const previewArmy=()=>{
    const match=get('countryPreview').textContent.match(/陆军\s*约\s*([\d.]+)\s*万人/);
    return match?Number(match[1]):null;
  };
  const expectedArmy=(scenario,id)=>Number((Math.round(data.opening(scenario,id,{reinforcedArmy:true}).personnel)/10000).toFixed(1));
  return {get,countryButton,previewArmy,expectedArmy,...data};
}

test('country shortcuts update the real select, selected state, army preview and map theater',()=>{
  const f=setup(),{get,countryButton,expectedArmy,previewArmy}=f;
  for(const id of ['usa','jpn','chn','ger']){
    countryButton(id).click();
    assert.equal(get('selCountry').value,id);
    assert.equal(countryButton(id).attributes['aria-pressed'],'true');
    assert.ok(get('countryChoices').children.filter(n=>n!==countryButton(id)).every(n=>n.attributes['aria-pressed']==='false'));
    assert.equal(previewArmy(),expectedArmy('sandbox36',id));
    assert.match(get('countryPreview').textContent,/增强兵力/);
    assert.match(get('startMapPreview').innerHTML,/preview-selected/);
  }
  countryButton('jpn').click();assert.match(get('startTheater').textContent,/亚洲/);
  countryButton('usa').click();assert.match(get('startTheater').textContent,/美洲/);
});

test('homepage offers only 1914 and 1936, with free country selection and era-specific previews',()=>{
  const {get,countryButton,previewArmy,expectedArmy}=setup();
  assert.deepEqual(Array.from(get('selScenario').children,n=>n.value),['ww1_1914','sandbox36']);
  assert.equal(get('selScenario').value,'sandbox36');
  countryButton('usa').click();
  get('selScenario').change('ww1_1914');
  assert.equal(get('selCountry').value,'usa');assert.equal(get('selCountry').disabled,false);
  countryButton('ger').click();assert.match(get('countryPreview').textContent,/德意志帝国/);
  assert.equal(previewArmy(),expectedArmy('ww1_1914','ger'));
  assert.ok(!get('selCountry').children.some(n=>n.value==='ccp'));
  assert.ok(!get('selCountry').children.some(n=>n.value==='pol'));
  get('selScenario').change('sandbox36');
  assert.equal(get('selCountry').disabled,false);assert.ok(get('countryChoices').children.every(n=>!n.disabled));
  assert.equal(previewArmy(),expectedArmy('sandbox36','ger'),'returning to 1936 discards the 1914 preview');
  countryButton('usa').click();assert.equal(get('selCountry').value,'usa');assert.equal(previewArmy(),expectedArmy('sandbox36','usa'));
});

test('native country selection retains every playable country and never reuses another country army preview',()=>{
  const {get,countryButton,previewArmy,expectedArmy,tables,countries,playable}=setup();
  assert.ok(get('selCountry').children.length>=playable.length);
  countryButton('ger').click();assert.equal(previewArmy(),expectedArmy('sandbox36','ger'));
  const minor=countries.find(c=>playable.includes(c.id)&&!get('countryChoices').children.some(b=>b.dataset.country===c.id)&&!tables.sandbox36[c.id]);
  assert.ok(minor,'use an actual playable country absent from the fixed major-power OOB table');
  get('selCountry').change(minor.id);assert.equal(get('selCountry').value,minor.id);
  assert.match(get('countryPreview').textContent,new RegExp(minor.name));
  assert.equal(previewArmy(),expectedArmy('sandbox36',minor.id),'minor preview uses its actual deployment budget');
  assert.ok(get('countryChoices').children.every(n=>n.attributes['aria-pressed']==='false'));
});
