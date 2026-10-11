const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildSite}=require('./build-site.cjs');
const root=path.resolve(__dirname,'..');
const site='9aa24c09-cc12-4580-ac39-c7ebf58a6674';
const url='https://gangtiexiongxin-game.netlify.app/';

function run(command,args,capture=false){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error((capture?(result.stderr||result.stdout):'')||`${path.basename(command)} failed (${result.status})`);
  return result.stdout;
}
async function main(){
  const commit=run('git',['rev-parse','HEAD'],true).trim();
  function ensureCommitted(){
    if(run('git',['status','--porcelain'],true).trim()||run('git',['rev-parse','HEAD'],true).trim()!==commit)throw new Error('工作区或提交发生变化，请先提交全部源代码，再发布：正式版本必须对应一个完整提交。');
  }
  ensureCommitted();
  run('git',['show','--format=','--check',commit]);
  run(process.execPath,['--test','--test-reporter=dot','tests/*.test.cjs']);
  run('python',['-B','-m','unittest','discover','-s','tests','-p','test_server.py']);
  ensureCommitted();
  const release=buildSite(root);
  ensureCommitted();
  const npx=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
  if(!fs.existsSync(npx))throw new Error('未找到 npm/npx，请安装标准 Node.js 后重试 npm run deploy。');
  console.log(`发布 v${release.version} · ${release.build}`);
  const result=run(process.execPath,[npx,'--yes','--package=netlify-cli@27.12.0','netlify','deploy','--prod','--no-build','--dir=dist','--site='+site,'--message',`v${release.version} ${release.build} ${release.commit}`,'--json'],true);
  let deployment;try{deployment=JSON.parse(result);}catch{throw new Error('Netlify 没有返回可验证的发布结果。');}
  if(!deployment.deploy_id)throw new Error('Netlify 缺少发布 ID。');
  let lastError;
  for(let attempt=0;attempt<8;attempt++){
    try{
      const response=await fetch(url+'version.json',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('version.json HTTP '+response.status);
      const online=await response.json();
      if(online.build!==release.build||online.commit!==release.commit)throw new Error('CDN 尚未返回新版本');
      const page=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      const html=await page.text();
      if(!page.ok||!html.includes(`name="hoi-build" content="${release.build}"`))throw new Error('主页版本未同步');
      if(!/must-revalidate/i.test(page.headers.get('cache-control')||''))throw new Error('正式站点缓存头未生效');
      console.log(JSON.stringify({url,version:release.version,build:release.build,commit:release.commit,deployId:deployment.deploy_id,verified:true},null,2));
      return;
    }catch(error){lastError=error;if(attempt<7)await new Promise(resolve=>setTimeout(resolve,3000));}
  }
  throw new Error('已上传，但正式站点验证失败：'+lastError.message+'。重试 npm run deploy，不能声称已更新。');
}
main().catch(error=>{console.error('发布失败：'+error.message);process.exitCode=1;});
