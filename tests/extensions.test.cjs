const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual startup functions without starting Electron or touching a profile.
const source = fs.readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['selectExtensions', 'updateAndLoadExtensions', 'updateExtension'];
const extracted = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(extracted.length, names.length);
const transpile = nodes => ts.transpileModule(nodes.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const code = transpile(extracted.filter(node => node.name.text !== 'updateExtension'));
const updateCode = transpile(extracted.filter(node => node.name.text === 'updateExtension'));
const KEY = 'official-public-key', NAME = "Tanki Online: Kaspersky's Inventions";
const base = path.resolve('profile', 'extensions');
const item = (name, manifest) => ({ path: path.join(base, name), manifest });
function fixture(installed = [], reserved = installed.map(extension => extension.path), updateFailure = null, localKiPath = '') {
    const updated = [], loaded = [], gateCalls = [], logs = [], reads = [];
    const context = { Path:path, KASPERSKY_EXTENSION_KEY:KEY,
        FS:{existsSync:()=>true,mkdirSync(){throw Error('Unexpected write');},
            readdirSync:()=>reserved.map(directory=>({name:path.basename(directory),isDirectory:()=>true})),
            readFileSync:filename=>{reads.push(filename);const entry=installed.find(extension=>path.dirname(filename)===extension.path);if(!entry)throw Error('Invalid manifest');return JSON.stringify(entry.manifest);}},
        log:{info:value=>logs.push(value),warn:value=>logs.push(value),error:value=>logs.push(String(value))},
        installKiGameGate:(ses,id,report)=>{gateCalls.push({ses,id});return `chrome-extension://${id}/dist/kasp_game_gate.js`;},
        updateExtension:async extension=>{updated.push(extension);if(updateFailure)throw updateFailure;},
        session:{defaultSession:{extensions:{loadExtension:async directory=>{loaded.push(directory);return {id:'a'.repeat(32)};}}}}
    };
    vm.runInNewContext(code, context);
    return {context,updated,loaded,gateCalls,logs,reads,
        select:()=>context.selectExtensions(installed,base,KEY,reserved),
        start:()=>context.updateAndLoadExtensions(path.dirname(base),localKiPath)};
}

test('store KI wins over local copies regardless of discovery order and advertised version',()=>{
    const local=item('local',{name:NAME,version:'999.0'}),store=item('managed',{name:NAME,key:KEY,version:'2.9.8'});
    for(const candidates of [[local,store],[store,local]]){
        const result=fixture(candidates).select();
        assert.equal(result.preferredKI,store);assert.deepEqual([...result.selected],[store]);
        assert.deepEqual([...result.skipped],[local]);assert.equal(local.manifest.key,undefined);
    }
});

test('local-only canonical installation requests an official update in a separate free directory',async()=>{
    const local=item('kaspersky-inventions',{name:NAME,version:'2.9.8'}),f=fixture([local]);
    await f.start();
    assert.equal(f.updated.length,1);assert.equal(f.updated[0].manifest.key,KEY);
    assert.equal(f.updated[0].path,path.join(base,'kaspersky-inventions-store'));
    assert.deepEqual(f.loaded,[path.join(base,'kaspersky-inventions-store')]);
    assert.equal(local.manifest.key,undefined);assert.ok(!f.loaded.includes(local.path));
});

test('fresh profile uses the canonical managed path and preserves unrelated extensions',async()=>{
    const fresh=fixture().select();assert.equal(fresh.preferredKI.path,path.join(base,'kaspersky-inventions'));
    assert.equal(fresh.preferredKI.manifest.key,KEY);
    const ordinary=item('other',{name:'Other',key:'other-key'}),f=fixture([ordinary]);
    await f.start();assert.equal(f.updated.length,2);assert.equal(f.updated[0].path,ordinary.path);
    assert.equal(f.updated[1].manifest.key,KEY);
    assert.deepEqual(f.loaded,[ordinary.path,path.join(base,'kaspersky-inventions')]);
});

test('directory collisions, invalid manifests and local copies never become an update destination',()=>{
    const local=item('kaspersky-inventions',{name:NAME});
    const occupied=[local.path,path.join(base,'kaspersky-inventions-store'),path.join(base,'kaspersky-inventions-store-2')];
    const result=fixture([local],occupied).select();
    assert.equal(result.preferredKI.path,path.join(base,'kaspersky-inventions-store-3'));
    assert.ok(!occupied.includes(result.preferredKI.path));
});

test('canonical official copy wins among duplicates and public-key identity survives a name change',async()=>{
    const alternate=item('old-store',{key:KEY,name:NAME}),canonical=item('kaspersky-inventions',{key:KEY,name:'Localized KI'});
    const ordinary=item('other',{name:'Other'}),f=fixture([alternate,ordinary,canonical]);
    const result=f.select();assert.equal(result.preferredKI,canonical);
    assert.deepEqual([...result.selected],[ordinary,canonical]);
    await f.start();assert.deepEqual(f.loaded,[ordinary.path,canonical.path]);
});

test('failed update check still loads the installed official copy and continues other extensions',async()=>{
    const store=item('kaspersky-inventions',{key:KEY,name:NAME,version:'2.9.8'}),ordinary=item('other',{name:'Other'});
    const f=fixture([store,ordinary],undefined,new Error('Update endpoint offline'));
    await f.start();assert.deepEqual(f.loaded,[store.path,ordinary.path]);
    assert.equal(f.updated.length,2);assert.equal(f.logs.filter(line=>line.includes('Update endpoint offline')).length,2);
});

function updater(downloaded={name:NAME,version:'3.0.0'}, installFailure=false) {
    const files=new Map(),removed=[],renamed=[],extension=item('kaspersky-inventions-store',{key:KEY,version:'2.9.8',update_url:'https://updates.example.test/crx'});
    files.set(path.join(extension.path,'manifest.json'),JSON.stringify(extension.manifest));
    const context={Path:path,extensionKeyToID:()=> 'official-id',getLatestExtensionVersion:async()=>({version:'3.0.0',crx:'https://download.example.test/package.crx'}),
        application:{getPath:()=>path.resolve('temp')},
        FileDownloader:class {async download(){}},unwrapCRX:()=>Buffer.from('zip'),fixZipEntryPermissions(){},
        extractZip:async(_file,{dir})=>files.set(path.join(dir,'manifest.json'),JSON.stringify(downloaded)),
        FS:{readFileSync:filename=>files.get(filename)||Buffer.from('crx'),writeFileSync:(filename,value)=>files.set(filename,value),
            mkdtempSync:prefix=>prefix+'fixture',existsSync:directory=>[...files.keys()].some(file=>file===directory||file.startsWith(directory+path.sep)),
            renameSync:(from,to)=>{if(installFailure&&to===extension.path&&!from.endsWith('-previous'))throw Error('Directory locked');renamed.push([from,to]);
                for(const [filename,data] of [...files])if(filename.startsWith(from+path.sep)){files.delete(filename);files.set(to+filename.slice(from.length),data);}},
            rmSync:filename=>{removed.push(filename);for(const file of [...files.keys()])if(file===filename||file.startsWith(filename+path.sep))files.delete(file);}}};
    vm.runInNewContext(updateCode,context);
    return {extension,files,removed,renamed,run:()=>context.updateExtension(extension)};
}

test('KI game gate installs for the selected store extension and not another extension',async()=>{
    const other=item('other',{name:'Unrelated'});
    const store=item('kaspersky-inventions',{name:NAME,key:KEY,version:'3.0.3'});
    const f=fixture([other,store]);
    await f.start();
    assert.deepEqual(f.loaded,[other.path,store.path]);
    assert.equal(f.gateCalls.length,1);
    assert.equal(f.gateCalls[0].ses,f.context.session.defaultSession);
    assert.equal(f.gateCalls[0].id,'a'.repeat(32));
    assert.ok(f.logs.some(message=>message.includes('[KI Game Gate] Enabled')));
});


test('local development KI takes priority over the store and never receives an update', async()=>{
    const store=item('kaspersky-inventions',{name:NAME,key:KEY,version:'99.0'});
    const other=item('other',{name:'Other',key:'other-key'});
    const dev={path:path.resolve('local-source', 'Kaspersky-Inventions'),
        manifest:{name:NAME,version:'3.0.3'}};
    const f=fixture([store,other,dev],[store.path,other.path],null,dev.path);
    await f.start();
    assert.deepEqual(f.loaded,[other.path,dev.path]);
    assert.deepEqual(f.updated.map(item=>item.path),[other.path]);
    assert.equal(f.gateCalls.length,1);
    assert.ok(f.logs.some(message=>message.includes('Using local development extension')));
    assert.ok(f.logs.some(message=>message.includes('Skipping local/duplicate extension')));
});

test('local KI under the managed extensions directory is loaded once, with no update',async()=>{
    const local=item('kaspersky-inventions',{name:NAME,version:'3.0.3'});
    const store=item('kaspersky-inventions-store',{name:NAME,key:KEY,version:'4.0.0'});
    const f=fixture([local,store],undefined,null,local.path);
    await f.start();
    assert.deepEqual(f.loaded,[local.path]);
    assert.equal(f.updated.length,0);
    assert.equal(f.gateCalls.length,1);
});

test('missing local KI directory fails explicitly and never falls back to the store',async()=>{
    const store=item('kaspersky-inventions',{name:NAME,key:KEY,version:'3.0.0'});
    const f=fixture([store],undefined,null,path.resolve('missing', 'ki'));
    await assert.rejects(f.start(),/Invalid local extension manifest/);
    assert.equal(f.loaded.length,0);
    assert.equal(f.updated.length,0);
});

test('local extension cannot masquerade as KI',async()=>{
    const unrelated={path:path.resolve('other-source', 'not-ki'),
        manifest:{name:'Other extension',version:'1.2.3'}};
    const f=fixture([unrelated],[],null,unrelated.path);
    await assert.rejects(f.start(),/does not contain a KI extension/);
    assert.equal(f.loaded.length,0);
});

test('store CRX without a manifest key retains its registered key and updater URL for the next launch',async()=>{
    const f=updater();await f.run();
    const installed=JSON.parse(f.files.get(path.join(f.extension.path,'manifest.json')));
    assert.equal(installed.key,KEY);assert.equal(installed.version,'3.0.0');
    assert.equal(installed.update_url,'https://updates.example.test/crx');
    const next=fixture([{path:f.extension.path,manifest:installed}]).select();
    assert.equal(next.preferredKI.path,f.extension.path);assert.equal(next.selected.length,1);
    assert.equal(f.extension.manifest.version,'3.0.0');
});

test('downloaded manifest mismatch is rejected and temporary archives are cleaned',async()=>{
    for(const downloaded of [{name:NAME,version:'2.0.0'},{name:NAME,version:'3.0.0',key:'foreign-key'}]){
        const f=updater(downloaded);await assert.rejects(f.run(),/identity\/version mismatch/);
        assert.ok(f.removed.some(filename=>filename.endsWith('.crx')));
        assert.ok(f.removed.some(filename=>filename.endsWith('.zip')));
        assert.equal(f.extension.manifest.version,'2.9.8');
        assert.equal(JSON.parse(f.files.get(path.join(f.extension.path,'manifest.json'))).version,'2.9.8');
        assert.equal(f.renamed.length,0);
    }
});

test('failed directory replacement restores the installed version without removing user files',async()=>{
    const f=updater(undefined,true);
    await assert.rejects(f.run(),/Directory locked/);
    assert.equal(JSON.parse(f.files.get(path.join(f.extension.path,'manifest.json'))).version,'2.9.8');
    assert.ok(f.renamed.some(([from,to])=>from.endsWith('-previous')&&to===f.extension.path));
    assert.ok(!f.removed.includes(f.extension.path));
});
