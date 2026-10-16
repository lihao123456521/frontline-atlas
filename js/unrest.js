const Unrest=(()=>{
  const limit=(value,min,max)=>Math.max(min,Math.min(max,value));
  const weight=province=>Number.isFinite(province.administrativeWeight)?province.administrativeWeight:1;
  const victoryWeight=province=>weight(province)+(province.isCapital?4:0);
  const pair=(first,second)=>[first,second].sort().join('|');
  const stockFields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  function personnel(unit){
    const definition=typeof UNIT_TYPES!=='undefined'?UNIT_TYPES[unit.type]:null;
    const nominal=unit.nominalPersonnel||((definition?.man||0)*(unit.formationPermille??1000));
    return nominal*limit(unit.hp/(unit.maxHp||1),0,1);
  }
  function forces(state,id){
    let people=0;
    for(const province of state.provinces)for(const unit of province.garrison)
      if((unit.owner||province.owner)===id&&unit.kind==='land')people+=personnel(unit);
    for(const combat of state.activeCombats||[])for(const entry of combat.attackers)
      if(entry.owner===id&&entry.unit.kind==='land')people+=personnel(entry.unit);
    return people;
  }
  function initialize(state){
    if(!state.unrest)state.unrest={serial:0,countries:{},conflicts:[],lastResponses:{}};
    for(const country of Object.values(state.countries)){
      if(state.unrest.countries[country.id])continue;
      const spanishDivision=country.id==='esp'&&state.date.year<=1937&&!country.rebellionOf;
      const people=forces(state,country.id);
      state.unrest.countries[country.id]={pressure:spanishDivision?76:limit((45-country.stability)*.6,0,40),division:spanishDivision?1:0,
        baselinePersonnel:people,previousPersonnel:people,lastDay:state.daysElapsed||0,warDays:0,lastAppeaseDay:null,lastRevoltDay:null};
    }
    return state.unrest;
  }
  function conflictsFor(state,id){
    return (state.unrest?.conflicts||[]).filter(conflict=>conflict.parent===id&&state.countries[conflict.rebels]?.alive);
  }
  function situation(state,id,record){
    const country=state.countries[id],owned=state.provinces.filter(province=>province.owner===id);
    const homeland=state.provinces.filter(province=>province.originalOwner===id),homeWeight=homeland.reduce((sum,province)=>sum+weight(province),0);
    const lost=homeWeight?homeland.filter(province=>province.owner!==id).reduce((sum,province)=>sum+weight(province),0)/homeWeight:0;
    const occupied=owned.length?owned.filter(province=>province.originalOwner!==id).length/owned.length:0;
    const war=state.wars.some(war=>war.a===id||war.b===id),current=forces(state,id);
    const casualties=Math.max(0,record.previousPersonnel-current)/Math.max(1,record.baselinePersonnel);
    const shortage=(country.res<10?.22:0)+(country.equipment<10?.2:0)+(war&&country.manpower<1?.12:0);
    const lowStability=Math.max(0,45-country.stability)*.035;
    const division=record.division*1.4*limit((90-country.stability)/25,0,1.5);
    const exhaustion=war?.08+Math.min(.45,record.warDays/240):0;
    const recovery=!war?.3+(country.stability>=65?.15:0)+(country.stability>=85?.2:0):0;
    const delta=lowStability+division+shortage+exhaustion+lost*.75+occupied*.25+Math.min(1.5,casualties*40)-recovery;
    const reasons=[];
    if(record.division>.3)reasons.push('国内派系分裂');
    if(lowStability)reasons.push('稳定不足');
    if(shortage)reasons.push('物资短缺');
    if(war)reasons.push('战争消耗');
    if(lost>.05)reasons.push('本土失地');
    if(occupied>.1)reasons.push('占领区抵抗');
    if(casualties>.005)reasons.push('军队伤亡');
    if(!reasons.length)reasons.push('和平与稳定正在缓解矛盾');
    return {delta,reasons,current,war};
  }
  function status(state,id=state?.player){
    const country=state?.countries?.[id],record=state?.unrest?.countries?.[id];
    if(!country||!record)return {pressure:0,level:'calm',label:'平稳',reason:'',reasons:[],active:false,rebels:[],canAppease:false,canNegotiate:false,lastResponse:null};
    const conflicts=conflictsFor(state,id),active=conflicts.some(conflict=>state.wars.some(war=>war.a===id&&war.b===conflict.rebels||war.b===id&&war.a===conflict.rebels));
    const divided=conflicts.length>0&&!active;
    const pressure=Math.round(record.pressure),level=active?'civilWar':divided?'ceasefire':pressure>=75?'critical':pressure>=40?'tense':'calm';
    const reasons=situation(state,id,record).reasons;
    if(divided)reasons.unshift('停火并非统一，反对派仍控制地区，可继续谈判');
    return {pressure,level,label:active?'内乱交战':divided?'停火分治':pressure>=75?'起义临近':pressure>=40?'局势紧张':'平稳',reason:reasons.join('、'),reasons,active,
      rebels:conflicts.map(conflict=>({id:conflict.rebels,name:state.countries[conflict.rebels].name,
        provinceCount:state.provinces.filter(province=>province.owner===conflict.rebels).length})),
      canAppease:country.alive&&!state.over&&record.lastAppeaseDay!==(state.daysElapsed||0),
      canNegotiate:country.alive&&!state.over&&conflicts.length>0,lastResponse:state.unrest.lastResponses[id]||null};
  }
  function safeProvinces(state,id){
    const busy=new Set();
    for(const combat of state.activeCombats||[]){
      for(const index of combat.routePath||[combat.from,combat.to])busy.add(index);
      for(const entry of combat.attackers)for(const index of entry.routePath||[])busy.add(index);
    }
    return state.provinces.map((province,index)=>({province,index})).filter(({province,index})=>province.owner===id&&province.originalOwner===id&&
      !province.isCapital&&!busy.has(index)&&province.garrison.some(unit=>(unit.owner||id)===id&&unit.kind==='land'&&unit.hp>0&&!unit.combatId)&&
      province.garrison.every(unit=>(unit.owner||id)===id)&&
      (state.adj[index]||[]).some(neighbor=>state.provinces[neighbor].owner===id));
  }
  function outbreakRegion(state,id,kind){
    const candidates=safeProvinces(state,id),capital=state.provinces[state.countries[id].capitalIdx];
    candidates.sort((first,second)=>{
      const firstDomestic=capital?Math.hypot(first.province.lon-capital.lon,first.province.lat-capital.lat)<15:false;
      const secondDomestic=capital?Math.hypot(second.province.lon-capital.lon,second.province.lat-capital.lat)<15:false;
      return Number(secondDomestic)-Number(firstDomestic)||second.province.garrison.length-first.province.garrison.length||first.index-second.index;
    });
    const first=candidates[0];if(!first)return [];
    const countryCount=state.provinces.filter(province=>province.owner===id&&province.originalOwner===id).length;
    const target=kind==='civilWar'?Math.min(6,Math.max(1,Math.floor(countryCount*.32))):Math.min(2,Math.max(1,Math.floor(countryCount*.06)));
    const chosen=[first.index],allowed=new Set(candidates.map(candidate=>candidate.index));
    while(chosen.length<target){
      const next=chosen.flatMap(index=>state.adj[index]||[]).find(index=>allowed.has(index)&&!chosen.includes(index));
      if(next===undefined)break;chosen.push(next);
    }
    if(!chosen.some(index=>(state.adj[index]||[]).some(neighbor=>state.provinces[neighbor].owner===id&&!chosen.includes(neighbor))))return [];
    return chosen;
  }
  function recalculate(state,id){
    const country=state.countries[id];
    country.initialVictoryWeight=state.provinces.reduce((sum,province)=>sum+(province.originalOwner===id?victoryWeight(province):0),0);
    country.initialLandDivisions=state.provinces.reduce((sum,province)=>sum+province.garrison.filter(unit=>(unit.owner||province.owner)===id&&unit.kind==='land')
      .reduce((total,unit)=>total+(unit.formationPermille??1000)/1000,0),0);
    country.initialLandDivisions+=(state.activeCombats||[]).reduce((sum,combat)=>sum+combat.attackers.filter(entry=>entry.owner===id&&entry.unit.kind==='land')
      .reduce((total,entry)=>total+(entry.unit.formationPermille??1000)/1000,0),0);
  }
  function splitStock(government,rebels,share){
    for(const field of stockFields){const amount=government[field]*share;rebels[field]=amount;government[field]-=amount;}
    if(government.mobilization){
      rebels.mobilization={...government.mobilization,taxDay:null,mobilizeDay:null};
      for(const field of ['capacity','reserve','consumed']){
        const amount=government.mobilization[field]*share;rebels.mobilization[field]=amount;government.mobilization[field]-=amount;
      }
    }
  }
  function begin(state,id,context){
    const government=state.countries[id],record=state.unrest.countries[id];
    const kind=record.division>.3||government.stability<18&&state.wars.some(war=>war.a===id||war.b===id)?'civilWar':'peasant';
    const region=outbreakRegion(state,id,kind);if(!region.length)return null;
    const serial=++state.unrest.serial,rebelsId=id+'_rebels_'+serial,capital=state.provinces[region[0]];
    const rebels=JSON.parse(JSON.stringify(government));
    Object.assign(rebels,{id:rebelsId,name:government.name+(kind==='civilWar'?'反对派':'起义军'),color:kind==='civilWar'?'#b94f59':'#bd743b',
      ideo:kind==='peasant'?'com':government.ideo==='fas'||government.ideo==='com'?'dem':'fas',capital:capital.id,capitalIdx:region[0],alive:true,subjectOf:null,
      rebellionOf:id,rebellionKind:kind,stability:45,warSupport:65,aiWarDay:state.daysElapsed||0,researchProgress:0});
    state.countries[rebelsId]=rebels;
    if(context.declareWar&&!context.declareWar(rebelsId,id)){
      delete state.countries[rebelsId];state.unrest.serial--;return null;
    }
    const controlled=state.provinces.filter(province=>province.owner===id),totalWeight=controlled.reduce((sum,province)=>sum+weight(province),0);
    const regionWeight=region.reduce((sum,index)=>sum+weight(state.provinces[index]),0);
    splitStock(government,rebels,limit(regionWeight/Math.max(.001,totalWeight),kind==='civilWar'?.18:.06,kind==='civilWar'?.4:.15));
    const beforePeople=forces(state,id);
    for(const index of region){
      const province=state.provinces[index];province.owner=rebelsId;province.originalOwner=rebelsId;
      for(const unit of province.garrison)if((unit.owner||id)===id)unit.owner=rebelsId;
    }
    capital.isCapital=true;
    const target=beforePeople*(kind==='civilWar'?.3:.09);let transferred=forces(state,rebelsId),destination=0;
    const donors=controlled.filter(province=>province.owner===id);
    const movable=donors.flatMap(province=>province.garrison.filter(unit=>(unit.owner||id)===id&&unit.kind==='land'&&unit.hp>0&&!unit.combatId)
      .slice(0,-1).map(unit=>({province,unit})));
    for(const {province,unit} of movable){
      if(transferred>=target)break;
      province.garrison=province.garrison.filter(candidate=>candidate!==unit);unit.owner=rebelsId;
      state.provinces[region[destination++%region.length]].garrison.push(unit);transferred+=personnel(unit);
    }
    state.relations[pair(id,rebelsId)]=-200;state.intel[pair(id,rebelsId)]=100;
    if(!context.declareWar)state.wars.push({a:rebelsId,b:id});
    const conflict={id:'revolt_'+serial,parent:id,rebels:rebelsId,kind,startedDay:state.daysElapsed||0,status:'war',provinceIds:region.map(index=>state.provinces[index].id)};
    state.unrest.conflicts.push(conflict);record.pressure=15;record.division=0;record.lastRevoltDay=state.daysElapsed||0;
    government.stability=limit(government.stability-(kind==='civilWar'?4:2),0,100);
    recalculate(state,id);recalculate(state,rebelsId);initialize(state);
    record.previousPersonnel=forces(state,id);state.unrest.countries[rebelsId].previousPersonnel=forces(state,rebelsId);
    const title=government.name+(kind==='civilWar'?'爆发内战':'爆发农民起义');
    context.log?.(title+'：'+region.map(index=>state.provinces[index].name).join('、')+'发生倒戈，既有军队与物资被分割。','war');
    context.recordWorldEvent?.('war',title,rebels.name+'控制了'+region.length+'个地区；可在地图作战，也可安抚或谈判。',region[0],[id,rebelsId],3);
    const front=region.map(from=>({from,to:(state.adj[from]||[]).find(to=>state.provinces[to].owner===id)})).find(front=>front.to!==undefined&&
      state.provinces[front.from].garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&!unit.combatId).length>=2);
    if(front&&context.doAssault){
      const count=state.provinces[front.from].garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&!unit.combatId).length;
      context.doAssault(rebelsId,front.from,front.to,0,Math.max(1,Math.floor(count*.55)),true);
    }
    return conflict;
  }
  function stopFighting(state,rebelsId,context){
    const combats=(state.activeCombats||[]).filter(combat=>combat.attacker===rebelsId||combat.defender===rebelsId||combat.attackers.some(entry=>entry.owner===rebelsId));
    if(combats.length&&!context.cancelCombat)return false;
    const combatIds=new Set(combats.map(combat=>combat.id));
    for(const combat of combats)context.cancelCombat(combat,'内乱谈判达成，部队撤回。');
    for(const event of state.worldEvents||[])if(event.kind==='invasion'&&(combatIds.has(event.combatId)||event.countryIds.includes(rebelsId)))event.acknowledged=true;
    state.wars=state.wars.filter(war=>war.a!==rebelsId&&war.b!==rebelsId);return true;
  }
  function reunite(state,conflict,context){
    const government=state.countries[conflict.parent],rebels=state.countries[conflict.rebels];
    if(!stopFighting(state,rebels.id,context))return false;
    if(government.subjectOf===rebels.id)government.subjectOf=null;
    const sovereign=government.subjectOf||government.id;
    for(const country of Object.values(state.countries))if(country.subjectOf===rebels.id)country.subjectOf=country.id===sovereign?null:sovereign;
    for(const war of state.wars.slice())if((state.countries[war.a].subjectOf||war.a)===sovereign&&
      (state.countries[war.b].subjectOf||war.b)===sovereign)context.settleDiplomaticWars(war.a,war.b);
    for(const province of state.provinces){
      if(province.owner===rebels.id){province.owner=government.id;province.isCapital=province.id===government.capital;}
      if(province.originalOwner===rebels.id)province.originalOwner=government.id;
      for(const unit of province.garrison)if(unit.owner===rebels.id)unit.owner=government.id;
    }
    for(const field of stockFields){government[field]+=rebels[field];rebels[field]=0;}
    if(rebels.mobilization&&government.mobilization)for(const field of ['capacity','reserve','consumed']){
      government.mobilization[field]+=rebels.mobilization[field];rebels.mobilization[field]=0;
    }
    if(state.aiBuildQueue){
      const queue=state.aiBuildQueue.filter(order=>order.countryId===rebels.id);state.aiBuildQueue=state.aiBuildQueue.filter(order=>order.countryId!==rebels.id);
      if(government.id===state.player)state.buildQueue.push(...queue.map(order=>({kind:'div',unitType:order.unitType,provinceIdx:order.provinceIdx,turnsLeft:order.turnsLeft})));
      else state.aiBuildQueue.push(...queue.map(order=>({...order,countryId:government.id})));
    }
    rebels.alive=false;rebels.subjectOf=null;rebels.capitalIdx=-1;
    for(const table of [state.alliances,state.guarantees,state.justifies,state.intel,state.relations])
      for(const key of Object.keys(table))if(key.split('|').includes(rebels.id))delete table[key];
    if(state.pendingPeace?.from===rebels.id)state.pendingPeace=null;
    conflict.status='reunited';recalculate(state,government.id);state.unrest.countries[government.id].previousPersonnel=forces(state,government.id);
    return true;
  }
  function respond(state,id,action,context={}){
    const country=state?.countries?.[id];if(!country?.alive||state.over||!['appease','negotiate'].includes(action))return false;
    initialize(state);const record=state.unrest.countries[id],day=state.daysElapsed||0;
    if(action==='appease'){
      if(record.lastAppeaseDay===day)return false;
      record.pressure=Math.max(0,record.pressure-28);record.division*=.15;record.lastAppeaseDay=day;country.stability=limit(country.stability+8,0,100);
      state.unrest.lastResponses[id]={action,outcome:'appeased',label:'安抚生效',reason:'稳定度 +8，内乱压力 -28；不消耗政治点。',day};
      context.log?.(country.name+'回应民生诉求，局势缓和。','good');return true;
    }
    const conflicts=conflictsFor(state,id);if(!conflicts.length)return false;
    if((state.activeCombats||[]).some(combat=>conflicts.some(conflict=>combat.attacker===conflict.rebels||combat.defender===conflict.rebels))&&!context.cancelCombat)return false;
    let reunited=true;
    for(const conflict of conflicts){
      const rebels=state.countries[conflict.rebels],relative=forces(state,id)/Math.max(1,forces(state,rebels.id));
      const lost=conflict.provinceIds.filter(provinceId=>state.provinces.find(province=>province.id===provinceId)?.owner!==rebels.id).length/Math.max(1,conflict.provinceIds.length);
      const score=country.stability*.7+Math.min(25,relative*8)+lost*35;
      if(score>=60){if(!reunite(state,conflict,context))return false;}
      else{
        if(!stopFighting(state,rebels.id,context))return false;
        state.relations[pair(id,rebels.id)]=25;conflict.status='ceasefire';reunited=false;
      }
      context.recordWorldEvent?.('peace',country.name+(conflict.status==='reunited'?'达成内乱和解':'与反对派停火'),
        conflict.status==='reunited'?'原有领土、军队与物资重新统一。':'双方停止交战，反对派仍控制现有地区；可继续外交谈判。',null,[id,rebels.id],2);
    }
    record.pressure=Math.max(0,record.pressure-20);record.division=0;
    state.unrest.lastResponses[id]={action,outcome:reunited?'reunited':'ceasefire',label:reunited?'和平统一':'达成停火',
      reason:reunited?'依据当前支持与兵力，反对派接受重新统一。':'政府支持不足以统一；双方已停止交战，领土仍分别控制。',day};
    context.log?.(country.name+'内乱谈判：'+state.unrest.lastResponses[id].label+'。','good');return true;
  }
  function tick(state,context={}){
    if(!state||state.over)return {changed:false,started:[]};initialize(state);
    const day=state.daysElapsed||0,started=[];let changed=false;
    for(const country of Object.values(state.countries)){
      if(!country.alive||country.rebellionOf)continue;
      const record=state.unrest.countries[country.id];if(record.lastDay===day)continue;
      const current=situation(state,country.id,record);record.lastDay=day;record.previousPersonnel=current.current;
      if(current.war)record.warDays++;else record.warDays=Math.max(0,record.warDays-2);
      const hasConflict=conflictsFor(state,country.id).length>0;
      record.pressure=limit(record.pressure+current.delta,0,100);changed=true;
      if(record.pressure>=100&&!hasConflict&&(record.lastRevoltDay===null||day-record.lastRevoltDay>=120)&&state.unrest.conflicts.length<64){
        const conflict=begin(state,country.id,context);if(conflict)started.push(conflict);
      }
    }
    for(const conflict of state.unrest.conflicts){
      if(!state.countries[conflict.parent].alive||!state.countries[conflict.rebels].alive){if(conflict.status!=='reunited')conflict.status='ended';}
      else conflict.status=state.wars.some(war=>war.a===conflict.parent&&war.b===conflict.rebels||war.b===conflict.parent&&war.a===conflict.rebels)?'war':'ceasefire';
    }
    return {changed,started};
  }
  function valid(state){
    if(state.unrest===undefined)return true;
    const value=state.unrest,object=input=>!!input&&typeof input==='object'&&!Array.isArray(input),day=state.daysElapsed||0;
    const validDay=input=>input===null||Number.isSafeInteger(input)&&input>=0&&input<=day;
    if(!object(value)||!Number.isSafeInteger(value.serial)||value.serial<0||!object(value.countries)||!Array.isArray(value.conflicts)||value.conflicts.length>64||!object(value.lastResponses))return false;
    for(const [id,record] of Object.entries(value.countries)){
      if(!Object.hasOwn(state.countries,id)||!object(record)||!Number.isFinite(record.pressure)||record.pressure<0||record.pressure>100||
        !Number.isFinite(record.division)||record.division<0||record.division>1||
        ['baselinePersonnel','previousPersonnel','warDays'].some(field=>!Number.isFinite(record[field])||record[field]<0)||
        !validDay(record.lastDay)||record.lastDay===null||!validDay(record.lastAppeaseDay)||!validDay(record.lastRevoltDay))return false;
    }
    const ids=new Set();
    for(const conflict of value.conflicts){
      if(!object(conflict)||typeof conflict.id!=='string'||!/^revolt_[1-9]\d*$/.test(conflict.id)||ids.has(conflict.id)||Number(conflict.id.slice(7))>value.serial||
        !Object.hasOwn(state.countries,conflict.parent)||!Object.hasOwn(state.countries,conflict.rebels)||conflict.parent===conflict.rebels||
        state.countries[conflict.rebels].rebellionOf!==conflict.parent||!['civilWar','peasant'].includes(conflict.kind)||
        !['war','ceasefire','reunited','ended'].includes(conflict.status)||!validDay(conflict.startedDay)||conflict.startedDay===null||
        !Array.isArray(conflict.provinceIds)||!conflict.provinceIds.length||new Set(conflict.provinceIds).size!==conflict.provinceIds.length||
        conflict.provinceIds.some(id=>!state.provinces.some(province=>province.id===id)))return false;
      ids.add(conflict.id);
    }
    for(const [id,response] of Object.entries(value.lastResponses))if(!Object.hasOwn(state.countries,id)||!object(response)||
      !['appease','negotiate'].includes(response.action)||!['appeased','reunited','ceasefire'].includes(response.outcome)||
      typeof response.label!=='string'||response.label.length>100||typeof response.reason!=='string'||response.reason.length>500||!validDay(response.day)||response.day===null)return false;
    return true;
  }
  return {initialize,tick,status,respond,valid};
})();
