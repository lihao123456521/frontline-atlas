const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fingerprint=data=>crypto.createHash('sha256').update(data).digest('hex').slice(0,12);

function buildSite(source=path.resolve(__dirname,'..')){
  const root=path.resolve(source),output=path.join(root,'dist');
  if(path.dirname(output)!==root||path.basename(output)!=='dist')throw new Error('Invalid publish directory');
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Map();
  html=html.replace(/(src|href)\s*=\s*(["'])(\/?(?:js|css)\/[a-zA-Z0-9_./-]+\.(?:js|css))(?:\?[^"'\s]*)?\2/g,(match,attribute,quote,url)=>{
    const file=url.replace(/^\//,'');
    if(file.split('/').includes('..'))throw new Error('Asset path must stay inside the project');
    const data=fs.readFileSync(path.join(root,file));files.set(file,data);
    return `${attribute}=${quote}${url}?v=${fingerprint(data)}${quote}`;
  });
  for(const match of html.matchAll(/(?:src|href)\s*=\s*(["'])([^"']+\.(?:js|css)(?:\?[^"']*)?)\1/g)){
    const file=match[2].split('?')[0].replace(/^\//,'');
    if(!/^(?:https?:)?\/\//.test(match[2])&&!files.has(file))throw new Error('Unsupported local asset: '+file);
  }
  if(!files.size)throw new Error('No game assets found');
  const headers=fs.readFileSync(path.join(root,'_headers'),'utf8');
  const build=fingerprint(Buffer.concat([Buffer.from(html+headers),...files.values()]));
  const version=html.match(/name="hoi-version" content="([^"]+)"/)?.[1]||'unknown';
  html=html.replace('</head>',`<meta name="hoi-build" content="${build}">\n</head>`);
  // Minimal test fixtures may omit a complete head.
  if(!html.includes('name="hoi-build"'))html=`<meta name="hoi-build" content="${build}">`+html;
  html=html.replace(/(id="releaseVersion"[^>]*>)[^<]*/,'$1版本 v'+version+' · '+build);
  let commit=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
  for(const [file,data] of files){const target=path.join(output,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
  const manifest={version,build,commit};
  fs.writeFileSync(path.join(output,'index.html'),html);
  fs.writeFileSync(path.join(output,'_headers'),headers);
  fs.writeFileSync(path.join(output,'version.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
module.exports={buildSite};
if(require.main===module)console.log(JSON.stringify(buildSite()));
