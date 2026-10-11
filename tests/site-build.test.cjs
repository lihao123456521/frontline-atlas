const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('release uses only referenced game files, fingerprints changes and keeps cache rules',()=>{
  const {buildSite}=require('../scripts/build-site.cjs');
  const parent=path.join(root,'.check');fs.mkdirSync(parent,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(parent,'site-build-'));
  try{
    fs.mkdirSync(path.join(fixture,'js'));fs.mkdirSync(path.join(fixture,'css'));
    fs.writeFileSync(path.join(fixture,'index.html'),'<meta name="hoi-version" content="43"><link href="css/style.css?v=42" rel="stylesheet"><script src="js/game.js?v=42.1"></script>');
    fs.writeFileSync(path.join(fixture,'js/game.js'),'window.example=1;');
    fs.writeFileSync(path.join(fixture,'css/style.css'),'body{color:red}');
    fs.writeFileSync(path.join(fixture,'_headers'),'/*\n  Cache-Control: no-cache, max-age=0, must-revalidate\n');
    fs.writeFileSync(path.join(fixture,'private.txt'),'must not publish');
    const first=buildSite(fixture),html=fs.readFileSync(path.join(fixture,'dist/index.html'),'utf8');
    assert.match(html,/js\/game\.js\?v=[a-f0-9]{12}/);
    assert.match(html,/name="hoi-build"/);
    assert.ok(!fs.existsSync(path.join(fixture,'dist/private.txt')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'dist/version.json'),'utf8')).build,first.build);
    assert.match(fs.readFileSync(path.join(fixture,'dist/_headers'),'utf8'),/must-revalidate/);
    assert.equal(buildSite(fixture).build,first.build);
    fs.writeFileSync(path.join(fixture,'js/game.js'),'window.example=2;');
    const second=buildSite(fixture);assert.notEqual(second.build,first.build);
    assert.notEqual(fs.readFileSync(path.join(fixture,'dist/index.html'),'utf8'),html);
    fs.writeFileSync(path.join(fixture,'js/stale.js'),'old build');buildSite(fixture);
    assert.ok(!fs.existsSync(path.join(fixture,'dist/js/stale.js')));
    fs.mkdirSync(path.join(fixture,'js/vendor'));
    fs.writeFileSync(path.join(fixture,'js/vendor/extra.js'),'nested');
    fs.appendFileSync(path.join(fixture,'index.html'),"<script src='js/vendor/extra.js'></script>");
    buildSite(fixture);assert.equal(fs.readFileSync(path.join(fixture,'dist/js/vendor/extra.js'),'utf8'),'nested');
    fs.appendFileSync(path.join(fixture,'index.html'),'<script src="other/unpublished.js"></script>');
    assert.throws(()=>buildSite(fixture),/Unsupported local asset/);
  }finally{
    assert.equal(path.dirname(path.resolve(fixture)),parent);
    fs.rmSync(fixture,{recursive:true,force:true});
  }
});
