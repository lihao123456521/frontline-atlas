/* Global diplomacy is a read-only view; commands remain in the country's diplomacy panel. */
const WorldOverview=(()=>{
  let stateRef=null,callbacks={},overlay=null,selected=null,filter='all',query='',ranking='land',previousFocus=null;
  const el=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls||'';if(text!==undefined)x.textContent=text;return x;};
  const button=(text,fn,cls='')=>{const x=el('button',cls,text);x.type='button';x.addEventListener('click',fn);return x;};
  const alive=()=>Object.values(stateRef?.countries||{}).filter(c=>c.alive);
  const name=id=>stateRef.countries[id]?.name||id;
  const known=id=>id===stateRef.player||(typeof Game!=='undefined'&&Game.canSee?.(id)===true);
  const number=n=>Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:1});
  function relations(countries){
    const edges=[];
    for(let i=0;i<countries.length;i++)for(let j=i+1;j<countries.length;j++){
      const a=countries[i].id,b=countries[j].id;
      if(Game.isAtWar(a,b))edges.push({a,b,kind:'war'});
      else if(Game.isAllied(a,b))edges.push({a,b,kind:'ally'});
    }
    return edges;
  }
  function stats(countries){
    return countries.map(c=>{
      const land=(stateRef.provinces||[]).filter(p=>p.owner===c.id).reduce((n,p)=>n+(Number.isFinite(p.administrativeWeight)?p.administrativeWeight:1),0);
      const visible=known(c.id),army=visible?Game.armyTotals?.(c.id):null;
      return {country:c,land,personnel:visible?Number(army?.personnel||0):null,equipment:visible?Number(c.equipment||0):null};
    });
  }
  function select(id){selected=id;render();}
  function svg(tag,attrs,text){const x=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))x.setAttribute(k,v);if(text!==undefined)x.textContent=text;return x;}
  function network(countries,edges,rows){
    const section=el('section','wo-network');section.appendChild(el('h3','',selected?`关系聚焦 · ${name(selected)}`:'全球关系网'));
    const controls=el('div','wo-filters');
    for(const [value,label]of [['all','战争与同盟'],['war','只看战争'],['ally','只看同盟']]){
      const b=button(label,()=>{filter=value;render();},filter===value?'active':'');b.dataset.filter=value;b.setAttribute('aria-pressed',String(filter===value));controls.appendChild(b);
    }
    if(selected)controls.appendChild(button('返回全局',()=>{selected=null;render();}));section.appendChild(controls);
    const visibleEdges=edges.filter(e=>filter==='all'||e.kind===filter),score=id=>edges.filter(e=>e.a===id||e.b===id).reduce((n,e)=>n+(e.kind==='war'?4:1),0);
    const majorIds=new Set(typeof COUNTRIES!=='undefined'?COUNTRIES.map(c=>c.id):[]);
    const related=new Set(selected?visibleEdges.filter(e=>e.a===selected||e.b===selected).flatMap(e=>[e.a,e.b]):[]);
    // Bound the diagram's density; the conflict list and searchable roster retain every country/edge.
    const nodes=countries.slice().sort((a,b)=>{
      const priority=c=>(c.id===selected?100000:0)+(selected&&related.has(c.id)?10000:0)+(c.id===stateRef.player?1000:0)+(majorIds.has(c.id)?100:0)+score(c.id)*10;
      return priority(b)-priority(a)||(rows.find(r=>r.country.id===b.id)?.land||0)-(rows.find(r=>r.country.id===a.id)?.land||0);
    }).slice(0,14);
    const ids=new Set(nodes.map(c=>c.id)),positions=new Map();
    nodes.forEach((c,i)=>{const angle=-Math.PI/2+i*Math.PI*2/nodes.length;positions.set(c.id,{x:440+300*Math.cos(angle),y:250+180*Math.sin(angle)});});
    const graph=svg('svg',{viewBox:'0 0 880 500',role:'img','aria-label':'国家关系网络：红色实线为战争，蓝色虚线为同盟'});
    visibleEdges.filter(e=>ids.has(e.a)&&ids.has(e.b)).forEach(e=>{
      const a=positions.get(e.a),b=positions.get(e.b),emphasized=!selected||e.a===selected||e.b===selected;
      graph.appendChild(svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:`wo-edge ${e.kind}${emphasized?'':' muted'}`,'data-a':e.a,'data-b':e.b,'data-kind':e.kind}));
    });
    nodes.forEach(c=>{
      const p=positions.get(c.id),group=svg('g',{class:`wo-node${selected===c.id?' selected':''}`,role:'button',tabindex:'0','aria-label':`聚焦${c.name}`,'data-country':c.id});
      group.appendChild(svg('rect',{x:p.x-65,y:p.y-23,width:130,height:46,rx:10}));
      group.appendChild(svg('text',{x:p.x,y:p.y+6,'text-anchor':'middle'},c.name));
      group.addEventListener('click',()=>select(c.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(c.id);}});graph.appendChild(group);
    });
    const viewport=el('div','wo-graph-wrap');viewport.appendChild(graph);section.appendChild(viewport);
    section.appendChild(el('p','wo-legend','红色实线＝战争 · 蓝色虚线＝同盟 · 无连线＝未结盟且未交战'));
    section.appendChild(el('p','wo-scope',`图中 ${nodes.length} / ${countries.length} 国：优先主要国、玩家与冲突中心。全部战争与同盟见右侧列表；其他国家见下方名单。`));
    return section;
  }
  function conflicts(countries,edges){
    const section=el('section','wo-conflicts');section.appendChild(el('h3','',filter==='all'?'全球关系清单':filter==='ally'?'世界同盟':'世界冲突'));
    const list=el('div','wo-pair-list'),pairs=edges.filter(e=>filter==='all'||e.kind===filter);
    if(!pairs.length)list.appendChild(el('p','','当前没有'+(filter==='all'?'战争或同盟':filter==='ally'?'同盟':'战争')));
    pairs.forEach(e=>{
      const row=el('div',`wo-pair ${e.kind}`);row.appendChild(button(name(e.a),()=>select(e.a)));row.appendChild(el('span','',e.kind==='war'?'⚔ 交战':'↔ 同盟'));row.appendChild(button(name(e.b),()=>select(e.b)));list.appendChild(row);
    });section.appendChild(list);
    if(selected){
      const detail=el('section','wo-country-detail');detail.appendChild(el('h3','',name(selected)));
      const actions=el('div','wo-actions');
      actions.appendChild(button('地图定位',()=>{const id=selected;close();callbacks.onFocusCountry?.(id);}));
      if(selected!==stateRef.player)actions.appendChild(button('打开外交',()=>{const id=selected;close();callbacks.onSelectCountry?.(id);}));
      detail.appendChild(actions);
      for(const [kind,label]of [['war','战争'],['ally','同盟'],['neutral','中立']]){
        const others=countries.filter(c=>c.id!==selected&&((kind==='war'&&Game.isAtWar(selected,c.id))||(kind==='ally'&&Game.isAllied(selected,c.id))||(kind==='neutral'&&!Game.isAtWar(selected,c.id)&&!Game.isAllied(selected,c.id))));
        const group=el('div','wo-country-relations');group.appendChild(el('h4','',`${label} · ${others.length}`));
        const roster=el('div','wo-related-list');others.forEach(c=>roster.appendChild(button(c.name,()=>select(c.id))));if(!others.length)roster.appendChild(el('span','','无'));group.appendChild(roster);detail.appendChild(group);
      }
      section.appendChild(detail);
    }
    return section;
  }
  function strength(rows){
    const section=el('section','wo-strength');section.appendChild(el('h3','','国家实力'));
    const control=el('select');control.setAttribute('aria-label','实力排序');
    [['land','按领土权重'],['personnel','按已掌握军力'],['equipment','按已掌握设备']].forEach(([v,t])=>{const o=el('option','',t);o.value=v;control.appendChild(o);});
    control.value=ranking;control.addEventListener('change',()=>{ranking=control.value;render();});section.appendChild(control);
    const table=el('table'),head=el('tr');['国家','领土权重','现有军力','设备'].forEach(t=>head.appendChild(el('th','',t)));const thead=el('thead');thead.appendChild(head);table.appendChild(thead);const tbody=el('tbody');
    rows.slice().sort((a,b)=>(b[ranking]??-1)-(a[ranking]??-1)).slice(0,8).forEach(r=>{
      const tr=el('tr'),td=el('td');td.appendChild(button(r.country.name,()=>select(r.country.id)));tr.appendChild(td);
      tr.appendChild(el('td','',number(r.land)));tr.appendChild(el('td','',r.personnel===null?'情报不足':number(Math.round(r.personnel))+' 人'));tr.appendChild(el('td','',r.equipment===null?'情报不足':number(r.equipment)));tbody.appendChild(tr);
    });table.appendChild(tbody);section.appendChild(table);
    section.appendChild(el('p','wo-scope','领土按省区权重计算。现有军力含驻军与在途部队、按实际编制及损耗计算；设备为库存。只显示本国或情报已掌握国家，其他国家不披露未侦察数据。'));return section;
  }
  function roster(countries,edges){
    const section=el('section','wo-roster');section.appendChild(el('h3','',`全部国家 · ${countries.length}`));
    const input=el('input');input.type='search';input.placeholder='搜索国家';input.value=query;input.setAttribute('aria-label','搜索全部国家');
    const list=el('div','wo-roster-list');
    const fill=()=>{
      list.innerHTML='';const matches=countries.filter(c=>c.name.includes(query)||c.id.toLowerCase().includes(query.toLowerCase()));
      matches.forEach(c=>{
        const wars=edges.filter(e=>e.kind==='war'&&(e.a===c.id||e.b===c.id)).length,allies=edges.filter(e=>e.kind==='ally'&&(e.a===c.id||e.b===c.id)).length;
        const b=button(`${c.name} · ${wars?'战争 '+wars+' / ':''}${allies?'同盟 '+allies:'无同盟'}`,()=>select(c.id),selected===c.id?'active':'');b.dataset.country=c.id;list.appendChild(b);
      });if(!matches.length)list.appendChild(el('p','','没有符合条件的国家'));
    };
    input.addEventListener('input',()=>{query=input.value;fill();});section.appendChild(input);section.appendChild(list);fill();return section;
  }
  function render(){
    if(!overlay||!stateRef)return;
    const focused=document.activeElement,focusCountry=focused?.dataset?.country,focusFilter=focused?.dataset?.filter;
    const countries=alive(),edges=relations(countries),rows=stats(countries);if(selected&&!countries.some(c=>c.id===selected))selected=null;
    overlay.innerHTML='';const panel=el('div','wo-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','wo-title');
    const header=el('header','wo-header'),title=el('h2','','全球统筹');title.id='wo-title';header.appendChild(title);header.appendChild(button('关闭 ×',close,'wo-close'));panel.appendChild(header);
    panel.appendChild(el('p','wo-summary',`${countries.length} 个存续国家 · ${edges.filter(e=>e.kind==='war').length} 场战争 · ${edges.filter(e=>e.kind==='ally').length} 对同盟`));
    const grid=el('div','wo-grid');grid.appendChild(network(countries,edges,rows));grid.appendChild(conflicts(countries,edges));grid.appendChild(strength(rows));grid.appendChild(roster(countries,edges));panel.appendChild(grid);overlay.appendChild(panel);
    const restore=focusCountry?overlay.querySelector(`[data-country="${focusCountry}"]`):focusFilter?overlay.querySelector(`[data-filter="${focusFilter}"]`):null;
    (restore||overlay.querySelector('.wo-close'))?.focus({preventScroll:true});
  }
  function keydown(e){
    if(!overlay)return;if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key!=='Tab')return;const buttons=overlay.querySelectorAll('button,input,select,[tabindex="0"]'),first=buttons[0],last=buttons[buttons.length-1];
    if(!overlay.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first)?.focus();return;}
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
  function open(state,options={}){
    if(!state)return;stateRef=state;callbacks=options;
    if(!overlay){previousFocus=document.activeElement;overlay=el('section','world-overview');overlay.id='worldOverview';document.body.appendChild(overlay);document.body.classList.add('world-overview-open');document.addEventListener('keydown',keydown);}
    render();overlay.querySelector('button')?.focus();
  }
  function close(){if(!overlay)return;overlay.remove();overlay=null;document.body.classList.remove('world-overview-open');document.removeEventListener('keydown',keydown);previousFocus?.focus?.();previousFocus=null;callbacks.onClose?.();}
  function refresh(state){if(!overlay)return;stateRef=state;render();}
  return {open,close,refresh,get isOpen(){return !!overlay;}};
})();
