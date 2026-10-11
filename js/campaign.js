/* 持久战役目标。只读取游戏状态；奖励由 Game 在领取时发放。 */
const Campaign = (function(){
  const counterNames = ["researchAssigned", "unitOrdered", "researchCompleted", "unitsTrained", "factoriesBuilt"];

  function create(state){
    return {
      stageIndex:0,
      counters:{ researchAssigned:0, unitOrdered:0, researchCompleted:0, unitsTrained:0, factoriesBuilt:0 },
      initialProvinceIds:state.provinces.filter(p => p.owner === state.player).map(p => p.id),
      strategy:null,
      rewards:[false,false,false],
    };
  }

  function valid(c, state){
    if (!c || typeof c !== "object" || !Number.isInteger(c.stageIndex) || c.stageIndex < 0 || c.stageIndex > 3) return false;
    if (!c.counters || counterNames.some(k => !Number.isSafeInteger(c.counters[k]) || c.counters[k] < 0)) return false;
    if (!Array.isArray(c.initialProvinceIds) || c.initialProvinceIds.some(id => typeof id !== "string" || !state.provinces.some(p => p.id === id))) return false;
    if (new Set(c.initialProvinceIds).size !== c.initialProvinceIds.length) return false;
    if (![null,"industry","expansion"].includes(c.strategy)) return false;
    if (!Array.isArray(c.rewards) || c.rewards.length !== 3 || c.rewards.some(v => typeof v !== "boolean")) return false;
    return c.rewards.every((v,i) => v === (i < c.stageIndex));
  }

  function describe(state){
    const c = state.campaign, n = c.counters, player = state.countries[state.player];
    const task = (id,title,detail,current,total,view) => ({id,title,detail,current,total,done:current >= total,view});
    const heldNew = state.provinces.filter(p => p.owner === state.player && !c.initialProvinceIds.includes(p.id)).length;
    if (c.stageIndex === 3) return {
      stageIndex:3,title:"阶段目标完成",description:"阶段目标已完成，继续经营或推进前线。",tasks:[],reward:"已领取全部奖励",status:"complete",strategy:c.strategy,
    };
    let title, description, tasks, reward;
    if (c.stageIndex === 0){
      title = "准备部署";
      description = "启动科研并下达训练命令，为后续扩军做准备。";
      tasks = [
        task("researchAssigned","安排一项研究","在科研页选择科技并分配空闲研究槽。",n.researchAssigned,1,"research"),
        task("unitOrdered","下达一项训练","在生产页将一个单位加入训练队列。",n.unitOrdered,1,"production"),
      ];
      reward = "政治权力 +30，装备 +20";
    } else if (c.stageIndex === 1){
      title = "扩军备战";
      description = "完成科研、训练两个单位并建成一座工厂。";
      tasks = [
        task("researchCompleted","完成一项研究","推进回合，等待已安排的科技完成。",n.researchCompleted,1,"research"),
        task("unitsTrained","训练两个单位","在生产页下单并推进生产进度。",n.unitsTrained,2,"production"),
        task("factoriesBuilt","建成一座工厂","在生产页建造民用或军用工厂。",n.factoriesBuilt,1,"production"),
      ];
      reward = "资源 +60，石油 +20";
    } else {
      title = "选择战略路线";
      description = "选择工业发展或领土扩张，完成对应目标。";
      if (c.strategy === "industry") tasks = [
        task("factoriesBuilt","累计建成三座工厂","从战役开始累计建成三座民用或军用工厂。",n.factoriesBuilt,3,"production"),
        task("stability","稳定度达到 60","通过国策和决策提升稳定度。",player.stability,60,"focus"),
      ];
      else if (c.strategy === "expansion") tasks = [
        task("newProvinces","控制两个新省份","控制两个战役开始时不属于你的省份。",heldNew,2,"province"),
      ];
      else tasks = [task("chooseStrategy","选择战略路线","在战役面板选择工业发展或领土扩张。",0,1,"campaign")];
      reward = "政治权力 +60，稳定度 +5";
    }
    return {stageIndex:c.stageIndex,title,description,tasks,reward,
      status:tasks.every(t => t.done) ? "ready" : "active",strategy:c.strategy};
  }

  return {create,valid,describe};
})();
