const Unrest=(()=>{
  const limit=(value,min,max)=>Math.max(min,Math.min(max,value));
  const weight=province=>Number.isFinite(province.administrativeWeight)?province.administrativeWeight:1;
  const victoryWeight=province=>weight(province)+(province.isCapital?4:0);
  const pair=(first,second)=>[first,second].sort().join('|');
  const stockFields=['civ','mil','res','equipment','oil','rare','pp','manpower','manpowerCap'];
  const arrived=(state,unit)=>(unit.rescueArrivalDay??0)<=(state.daysElapsed||0);
  function personnel(unit){
    const definition=typeof UNIT_TYPES!=='undefined'?UNIT_TYPES[unit.type]:null;
    const nominal=unit.nominalPersonnel||((definition?.man||0)*(unit.formationPermille??1000));
    return nominal*limit(unit.hp/(unit.maxHp||1),0,1);
  }
  function forces(state,id){
    let people=0;
    for(const province of state.provinces)for(const unit of province.garrison)
      if((unit.owner||province.owner)===id&&unit.kind==='land'&&arrived(state,unit))people+=personnel(unit);
    for(const combat of state.activeCombats||[])for(const entry of combat.attackers)
      if(entry.owner===id&&entry.unit.kind==='land'&&arrived(state,entry.unit))people+=personnel(entry.unit);
    return people;
  }
  function initialize(state){
    if(!state.unrest)state.unrest={serial:0,countries:{},conflicts:[],lastResponses:{}};
    if(!state.unrest.occupations)state.unrest.occupations={};
    for(const country of Object.values(state.countries)){
      const spanishDivision=country.id==='esp'&&state.date.year<=1937&&!country.rebellionOf;
      if(state.unrest.countries[country.id]){
        const record=state.unrest.countries[country.id];
        if(spanishDivision&&record.lastDay===0&&record.pressure===44&&record.division===.45&&
          !(state.unrest.conflicts||[]).some(conflict=>conflict.parent===country.id)){
          record.pressure=Math.max(record.pressure,60);record.division=Math.max(record.division,.8);
        }
        continue;
      }
      const people=forces(state,country.id);
      state.unrest.countries[country.id]={pressure:spanishDivision?60:limit((35-country.stability)*.45,0,25),division:spanishDivision?.8:0,
        baselinePersonnel:people,previousPersonnel:people,lastDay:state.daysElapsed||0,warDays:0,lastAppeaseDay:null,lastRevoltDay:null,sponsorships:{}};
    }
    return state.unrest;
  }
  function observeOccupation(state,index,options={}){
    const province=state.provinces[index],controller=state.countries[province?.owner],origin=state.countries[province?.originalOwner];
    if(!province||!controller||!origin)return null;
    initialize(state);const records=state.unrest.occupations,previous=records[province.id];
    if(province.owner===province.originalOwner){
      if(previous?.reserve&&origin.mobilization){origin.mobilization.reserve+=previous.reserve/1000;origin.mobilization.capacity+=previous.reserve/1000;previous.capacity-=previous.reserve;previous.reserve=0;}
      if(previous)previous.controller=province.owner;
      return null;
    }
    if(controller.rebellionKind==='occupation')return previous||null;
    if(previous&&previous.controller===province.owner)return previous;
    const total=state.provinces.filter(land=>land.originalOwner===origin.id).reduce((sum,land)=>sum+weight(land),0);
    const requested=Math.max(600,Math.round((origin.mobilization?.capacity||0)*1000*weight(province)/Math.max(.001,total)*.06));
    const reserve=previous?previous.reserve:Math.min((origin.mobilization?.reserve||0)*1000,requested);
    if(!previous&&origin.mobilization){origin.mobilization.reserve=Math.max(0,origin.mobilization.reserve-reserve/1000);origin.mobilization.capacity-=reserve/1000;}
    const consent=Number.isFinite(options.consent)?options.consent:0;
    return records[province.id]={origin:origin.id,controller:province.owner,support:limit(28+(controller.stability-origin.stability)*.12+consent*.5,10,80),
      resistance:limit(48-consent*.35,10,65),reserve,capacity:previous?.capacity||reserve,consumed:previous?.consumed||0,
      lastDay:state.daysElapsed||0,lastAppeaseDay:null,lastRevoltDay:previous?.lastRevoltDay??null,losses:previous?.losses||0};
  }
  function provinceStatus(state,index){
    const province=state?.provinces?.[index],record=state?.unrest?.occupations?.[province?.id];
    if(!province||!record||province.owner===province.originalOwner||state.countries[province.owner]?.rebellionKind==='occupation')return null;
    const garrison=province.garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&arrived(state,unit)).reduce((sum,unit)=>sum+personnel(unit),0);
    const required=Math.max(1000,record.capacity*.45),suppression=garrison/required;
    return {support:Math.round(record.support),resistance:Math.round(record.resistance),reserve:Math.round(record.reserve),
      label:record.resistance>=75?'抵抗高涨':record.resistance>=45?'民意不稳':'逐渐安定',garrison:Math.round(garrison),required:Math.ceil(required),
      garrisonSuppressed:suppression>=1,losses:Math.round(record.losses),origin:record.origin,
      canAppease:province.owner===state.player&&record.lastAppeaseDay!==(state.daysElapsed||0)};
  }
  function appeaseProvince(state,index,controller=state?.player){
    const province=state?.provinces?.[index];if(!province||province.owner!==controller||state.over)return false;
    const record=observeOccupation(state,index);if(!record||record.lastAppeaseDay===(state.daysElapsed||0))return false;
    record.support=limit(record.support+18,0,100);record.resistance=limit(record.resistance-22,0,100);record.lastAppeaseDay=state.daysElapsed||0;
    return true;
  }
  function occupationOutbreak(state,index,record,context){
    const province=state.provinces[index],government=state.countries[province.owner];
    if(!context.makeDivision||province.garrison.some(unit=>unit.kind==='land'&&unit.hp>0&&arrived(state,unit))||
      province.garrison.some(unit=>unit.hp>0&&arrived(state,unit))&&!context.returnTroop||(state.activeCombats||[]).some(combat=>combat.to===index||combat.from===index)||
      record.reserve<200||state.unrest.conflicts.length>=64)return null;
    const serial=++state.unrest.serial,rebelsId=record.origin+'_resistance_'+serial,rebels=JSON.parse(JSON.stringify(government));
    const nearby=[government.color,...(state.adj[index]||[]).map(neighbor=>state.countries[state.provinces[neighbor].owner]?.color)].filter(Boolean);
    const color=typeof countryFactionColor==='function'?countryFactionColor(state.countries[record.origin].color,rebelsId,nearby):'#bd743b';
    Object.assign(rebels,{id:rebelsId,name:state.countries[record.origin].name+'抵抗军',color,ideo:'neu',capital:province.id,capitalIdx:index,
      alive:true,subjectOf:null,rebellionOf:government.id,rebellionKind:'occupation',stability:45,warSupport:75,aiWarDay:state.daysElapsed||0,researchProgress:0});
    for(const field of stockFields)rebels[field]=0;
    rebels.mobilization={...government.mobilization,capacity:0,reserve:0,consumed:0,taxDay:null,mobilizeDay:null};
    state.countries[rebelsId]=rebels;
    if(context.declareWar&&!context.declareWar(rebelsId,government.id)){delete state.countries[rebelsId];state.unrest.serial--;return null;}
    const definition=UNIT_TYPES.infantry,budget=Math.min(3200,record.reserve),scale=Math.min(1000,Math.floor(budget/(definition.man*2)));
    const troops=[context.makeDivision('infantry',scale),context.makeDivision('infantry',scale)];
    const spent=troops.reduce((sum,unit)=>sum+personnel(unit),0);record.reserve=Math.max(0,record.reserve-spent);record.consumed+=spent;
    for(const unit of troops){unit.owner=rebelsId;unit.org*=.65;}
    const displaced=province.garrison.filter(unit=>arrived(state,unit));province.garrison=province.garrison.filter(unit=>!arrived(state,unit));
    for(const unit of displaced)context.returnTroop?.(unit,unit.owner||government.id,index,index);
    province.owner=rebelsId;province.garrison.push(...troops);province.isCapital=true;
    rebels.initialVictoryWeight=victoryWeight(province);rebels.initialLandDivisions=troops.reduce((sum,unit)=>sum+(unit.formationPermille??1000)/1000,0);
    state.relations[pair(government.id,rebelsId)]=-200;state.intel[pair(government.id,rebelsId)]=100;
    if(!context.declareWar)state.wars.push({a:rebelsId,b:government.id});
    const conflict={id:'revolt_'+serial,parent:government.id,rebels:rebelsId,kind:'occupation',startedDay:state.daysElapsed||0,status:'war',provinceIds:[province.id]};
    state.unrest.conflicts.push(conflict);record.lastRevoltDay=state.daysElapsed||0;initialize(state);
    context.afterControlChange?.();
    context.log?.(province.name+'爆发占领区起义，当地有限后备组成抵抗军，原占领守军未被复制或倒戈。','war');
    context.recordWorldEvent?.('war',province.name+'爆发占领区起义','民意恶化与守备不足使抵抗军建立根据地；邻省归属仍由实际战斗决定。',index,[government.id,rebelsId],3);
    const to=(state.adj[index]||[]).find(neighbor=>state.provinces[neighbor].owner===government.id);
    if(to!==undefined&&context.doAssault)context.doAssault(rebelsId,index,to,0,1,true);
    return conflict;
  }
  function tickOccupation(state,context){
    const day=state.daysElapsed||0,started=[];
    for(let index=0;index<state.provinces.length;index++){
      const province=state.provinces[index],record=observeOccupation(state,index);if(!record||record.lastDay===day||state.countries[province.owner]?.rebellionKind==='occupation')continue;
      const controller=state.countries[province.owner];record.lastDay=day;
      const status=provinceStatus(state,index),suppression=status.garrison/Math.max(1,status.required);
      const shortage=(controller.res<10||controller.equipment<10)?1:0,war=state.wars.some(war=>war.a===controller.id||war.b===controller.id);
      record.support=limit(record.support+(controller.stability-55)*.008+Math.min(1,suppression)*.2+(record.lastAppeaseDay===day?.4:0)-shortage*.15-(war?.08:0),0,100);
      record.resistance=limit(record.resistance+(50-record.support)*.02+shortage*.12+(war?.06:0)-Math.min(3,suppression)*.9,0,100);
      if(record.resistance>=80&&suppression<1&&record.reserve>0){
        const guards=province.garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&!unit.combatId&&arrived(state,unit));
        const people=guards.reduce((sum,unit)=>sum+personnel(unit),0),loss=Math.min(people,Math.max(3,people*.06)*(1-suppression),record.reserve*.08);
        if(people&&loss>0){
          for(const unit of guards)unit.hp=Math.max(0,unit.hp-unit.maxHp*(loss/people)*(unit.hp/unit.maxHp));
          record.losses+=loss;const exhausted=Math.min(record.reserve,Math.max(1,loss*.35));record.reserve-=exhausted;record.consumed+=exhausted;
          for(const unit of guards)if(unit.hp<=unit.maxHp*.01){record.losses+=personnel(unit);unit.hp=0;}
          province.garrison=province.garrison.filter(unit=>unit.hp>unit.maxHp*.01||unit.kind!=='land'||unit.combatId);
          if(Math.floor(record.losses/100)!==Math.floor((record.losses-loss)/100))context.log?.(province.name+'抵抗活动持续损耗小股守军；增援或安抚可降低风险。','war');
        }
      }
      if(record.resistance>=97&&record.support<22&&(record.lastRevoltDay===null||day-record.lastRevoltDay>=240)){
        const conflict=occupationOutbreak(state,index,record,context);if(conflict)started.push(conflict);
      }
    }
    return started;
  }
  function conflictsFor(state,id){
    return (state.unrest?.conflicts||[]).filter(conflict=>conflict.parent===id&&state.countries[conflict.rebels]?.alive);
  }
  function activeSponsors(state,id,record=state.unrest?.countries?.[id]){
    const day=state.daysElapsed||0;
    return Object.entries(record?.sponsorships||{}).filter(([sponsor,backing])=>state.countries[sponsor]?.alive&&
      !state.countries[sponsor].subjectOf&&sponsor!==id&&day-backing.lastDay<=180);
  }
  function sponsor(state,id,sponsorId,context={}){
    const target=state?.countries?.[id],patron=state?.countries?.[sponsorId];
    if(!target?.alive||!patron?.alive||id===sponsorId||patron.subjectOf||target.subjectOf===sponsorId||state.over)return false;
    initialize(state);const record=state.unrest.countries[id],day=state.daysElapsed||0;
    if(!record.sponsorships)record.sponsorships={};
    const previous=record.sponsorships[sponsorId];
    record.sponsorships[sponsorId]={influence:1,startedDay:previous?.startedDay??day,lastDay:day};
    if(!previous||day-previous.lastDay>180)record.pressure=limit(record.pressure+8,0,100);
    context.log?.('已在 '+target.name+' 扶持反对派；外部支援会逐步增加内乱压力，不改变现政府的领土或军队。','info');
    return true;
  }
  function situation(state,id,record){
    const country=state.countries[id],owned=state.provinces.filter(province=>province.owner===id);
    const homeland=state.provinces.filter(province=>province.originalOwner===id),homeWeight=homeland.reduce((sum,province)=>sum+weight(province),0);
    const lost=homeWeight?homeland.filter(province=>province.owner!==id).reduce((sum,province)=>sum+weight(province),0)/homeWeight:0;
    const occupied=owned.length?owned.filter(province=>province.originalOwner!==id).length/owned.length:0;
    const war=state.wars.some(war=>war.a===id||war.b===id),current=forces(state,id);
    const casualties=Math.max(0,record.previousPersonnel-current)/Math.max(1,record.baselinePersonnel);
    const shortage=(country.res<10?.1:0)+(country.equipment<10?.09:0)+(war&&country.manpower<1?.06:0);
    const lowStability=Math.max(0,35-country.stability)*.022;
    const division=record.division*.5*limit((110-country.stability)/10,0,1.2);
    const exhaustion=war?.04+Math.min(.25,record.warDays/500):0;
    const recovery=!war?Math.max(0,.28+(country.stability>=65?.15:0)+(country.stability>=85?.15:0)-record.division*.8):Math.max(0,(country.stability-55)*.006);
    const external=Math.max(0,...activeSponsors(state,id,record).map(([,backing])=>backing.influence))*.8;
    const delta=lowStability+division+shortage+exhaustion+lost*.45+occupied*.1+Math.min(.7,casualties*25)+external-recovery;
    const reasons=[];
    if(record.division>.3)reasons.push('国内派系分裂');
    if(lowStability)reasons.push('稳定不足');
    if(shortage)reasons.push('物资短缺');
    if(war)reasons.push('战争消耗');
    if(lost>.05)reasons.push('本土失地');
    if(occupied>.1)reasons.push('占领区抵抗');
    if(casualties>.005)reasons.push('军队伤亡');
    if(external)reasons.push('反对派获得外部扶持');
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
    const occupied=state.provinces.map((province,index)=>province.owner===id?provinceStatus(state,index):null).filter(Boolean);
    return {pressure,level,label:active?'内乱交战':divided?'停火分治':pressure>=75?'起义临近':pressure>=40?'局势紧张':'平稳',reason:reasons.join('、'),reasons,active,
      occupiedCount:occupied.length,resistingCount:occupied.filter(province=>province.resistance>=75).length,maxResistance:Math.max(0,...occupied.map(province=>province.resistance)),
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
      !province.isCapital&&!busy.has(index)&&province.garrison.some(unit=>(unit.owner||id)===id&&unit.kind==='land'&&unit.hp>0&&!unit.combatId&&arrived(state,unit))&&
      province.garrison.every(unit=>(unit.owner||id)===id&&arrived(state,unit))&&
      (state.adj[index]||[]).some(neighbor=>state.provinces[neighbor].owner===id));
  }
  function outbreakRegion(state,id,kind){
    const candidates=safeProvinces(state,id),capital=state.provinces[state.countries[id].capitalIdx];
    const backed=activeSponsors(state,id).length>0;
    const currentPersonnel=forces(state,id),budget=currentPersonnel*(kind==='civilWar'?(backed?.28:.15):.05);
    const maximum=currentPersonnel*(kind==='civilWar'?(backed?.30:.18):.05);
    const strength=province=>province.garrison.filter(unit=>unit.kind==='land'&&arrived(state,unit)).reduce((sum,unit)=>sum+personnel(unit),0);
    const landCount=province=>province.garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&!unit.combatId&&arrived(state,unit)).length;
    candidates.sort((first,second)=>{
      const firstDomestic=capital?Math.hypot(first.province.lon-capital.lon,first.province.lat-capital.lat)<15:false;
      const secondDomestic=capital?Math.hypot(second.province.lon-capital.lon,second.province.lat-capital.lat)<15:false;
      return Math.abs(budget-strength(first.province))-Math.abs(budget-strength(second.province))||
        Number(secondDomestic)-Number(firstDomestic)||Number(landCount(second.province)>=2)-Number(landCount(first.province)>=2)||first.index-second.index;
    });
    const first=candidates.find(candidate=>strength(candidate.province)<=maximum);if(!first)return [];
    const target=kind==='civilWar'?8:1;
    const allowed=new Set(candidates.map(candidate=>candidate.index));
    let chosen=[];
    for(const start of candidates){
      if(strength(start.province)>maximum)continue;
      const region=[start.index];
      while(region.length<target){
        const committed=region.reduce((sum,index)=>sum+strength(state.provinces[index]),0);
        const next=region.flatMap(index=>state.adj[index]||[]).filter(index=>allowed.has(index)&&!region.includes(index)&&
          committed+strength(state.provinces[index])<=maximum).sort((first,second)=>strength(state.provinces[second])-strength(state.provinces[first]))[0];
        if(next===undefined)break;region.push(next);
      }
      const people=region.reduce((sum,index)=>sum+strength(state.provinces[index]),0),best=chosen.reduce((sum,index)=>sum+strength(state.provinces[index]),0);
      if(people>best)chosen=region;
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
    const kind=activeSponsors(state,id,record).length>0||record.division>.3||government.stability<18&&state.wars.some(war=>war.a===id||war.b===id)?'civilWar':'peasant';
    const region=outbreakRegion(state,id,kind);if(!region.length)return null;
    const serial=++state.unrest.serial,rebelsId=id+'_rebels_'+serial,capital=state.provinces[region[0]];
    const patron=activeSponsors(state,id,record).sort((first,second)=>second[1].influence-first[1].influence||first[1].startedDay-second[1].startedDay||first[0].localeCompare(second[0]))[0]?.[0];
    const rebels=JSON.parse(JSON.stringify(government));
    const nearby=region.flatMap(index=>state.adj[index]||[]).map(index=>state.countries[state.provinces[index].owner]?.color).filter(Boolean);
    const color=typeof countryFactionColor==='function'?countryFactionColor(government.color,rebelsId,nearby):kind==='civilWar'?'#b94f59':'#bd743b';
    Object.assign(rebels,{id:rebelsId,name:government.name+(kind==='civilWar'?'反对派':'起义军'),color,
      ideo:kind==='peasant'?'com':government.ideo==='fas'||government.ideo==='com'?'dem':'fas',capital:capital.id,capitalIdx:region[0],alive:true,
      subjectOf:patron&&patron!==government.subjectOf?patron:null,
      rebellionOf:id,rebellionKind:kind,stability:45,warSupport:65,aiWarDay:state.daysElapsed||0,researchProgress:0,capturedPersonnel:0});
    state.countries[rebelsId]=rebels;
    if(context.declareWar&&!context.declareWar(rebelsId,id)){
      delete state.countries[rebelsId];state.unrest.serial--;return null;
    }
    const controlled=state.provinces.filter(province=>province.owner===id),totalWeight=controlled.reduce((sum,province)=>sum+weight(province),0);
    const regionWeight=region.reduce((sum,index)=>sum+weight(state.provinces[index]),0);
    const resourceCap=kind==='civilWar'?(patron?.28:.18):.05;
    splitStock(government,rebels,limit(regionWeight/Math.max(.001,totalWeight),.01,resourceCap));
    for(const index of region){
      const province=state.provinces[index];province.owner=rebelsId;province.originalOwner=rebelsId;
      for(const unit of province.garrison)if((unit.owner||id)===id)unit.owner=rebelsId;
    }
    capital.isCapital=true;
    if(rebels.subjectOf){
      state.alliances[pair(patron,rebelsId)]=true;state.relations[pair(patron,rebelsId)]=100;
      const oldCommitment=state.alliances[pair(patron,id)]||state.guarantees?.[pair(patron,id)];
      delete state.alliances[pair(patron,id)];
      if(state.guarantees)delete state.guarantees[pair(patron,id)];
      if(oldCommitment)context.log?.(state.countries[patron].name+'公开扶持反对派，终止对 '+government.name+' 原政府的防御承诺。','war');
    }
    context.afterControlChange?.();
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
      state.provinces[front.from].garrison.filter(unit=>unit.kind==='land'&&unit.hp>0&&!unit.combatId).length>=1);
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
      const support=conflict.kind==='occupation'?conflict.provinceIds.reduce((sum,provinceId)=>sum+(state.unrest.occupations[provinceId]?.support||0),0)/conflict.provinceIds.length:country.stability;
      const score=support*.7+Math.min(25,relative*8)+lost*35;
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
    const day=state.daysElapsed||0,started=tickOccupation(state,context);let changed=false;
    for(const country of Object.values(state.countries)){
      if(!country.alive||country.rebellionOf)continue;
      const record=state.unrest.countries[country.id];if(record.lastDay===day)continue;
      const critical=record.pressure>=100;
      const current=situation(state,country.id,record);record.lastDay=day;record.previousPersonnel=current.current;
      if(current.war)record.warDays++;else record.warDays=Math.max(0,record.warDays-2);
      const hasConflict=conflictsFor(state,country.id).length>0;
      record.pressure=limit(record.pressure+current.delta,0,100);changed=true;
      if((critical||record.pressure>=100)&&!hasConflict&&(record.lastRevoltDay===null||day-record.lastRevoltDay>=365)&&state.unrest.conflicts.length<64){
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
    if(!object(value)||!Number.isSafeInteger(value.serial)||value.serial<0||!object(value.countries)||!Array.isArray(value.conflicts)||value.conflicts.length>64||!object(value.lastResponses)||
      value.occupations!==undefined&&!object(value.occupations))return false;
    for(const [id,record] of Object.entries(value.occupations||{})){
      if(!state.provinces.some(province=>province.id===id)||!object(record)||!Object.hasOwn(state.countries,record.origin)||!Object.hasOwn(state.countries,record.controller)||
        ['support','resistance'].some(field=>!Number.isFinite(record[field])||record[field]<0||record[field]>100)||
        ['reserve','capacity','consumed','losses'].some(field=>!Number.isFinite(record[field])||record[field]<0)||
        record.reserve+record.consumed>record.capacity+1e-7||!validDay(record.lastDay)||record.lastDay===null||!validDay(record.lastAppeaseDay)||!validDay(record.lastRevoltDay))return false;
    }
    for(const [id,record] of Object.entries(value.countries)){
      if(!Object.hasOwn(state.countries,id)||!object(record)||!Number.isFinite(record.pressure)||record.pressure<0||record.pressure>100||
        !Number.isFinite(record.division)||record.division<0||record.division>1||
        ['baselinePersonnel','previousPersonnel','warDays'].some(field=>!Number.isFinite(record[field])||record[field]<0)||
        !validDay(record.lastDay)||record.lastDay===null||!validDay(record.lastAppeaseDay)||!validDay(record.lastRevoltDay)||
        record.sponsorships!==undefined&&!object(record.sponsorships))return false;
      for(const [sponsor,backing]of Object.entries(record.sponsorships||{}))if(!Object.hasOwn(state.countries,sponsor)||sponsor===id||!object(backing)||
        !Number.isFinite(backing.influence)||backing.influence<0||backing.influence>1||!validDay(backing.startedDay)||backing.startedDay===null||
        !validDay(backing.lastDay)||backing.lastDay===null||backing.startedDay>backing.lastDay)return false;
    }
    const ids=new Set();
    for(const conflict of value.conflicts){
      if(!object(conflict)||typeof conflict.id!=='string'||!/^revolt_[1-9]\d*$/.test(conflict.id)||ids.has(conflict.id)||Number(conflict.id.slice(7))>value.serial||
        !Object.hasOwn(state.countries,conflict.parent)||!Object.hasOwn(state.countries,conflict.rebels)||conflict.parent===conflict.rebels||
        state.countries[conflict.rebels].rebellionOf!==conflict.parent||!['civilWar','peasant','occupation'].includes(conflict.kind)||
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
  return {initialize,tick,status,respond,valid,observeOccupation,provinceStatus,appeaseProvince,sponsor};
})();
