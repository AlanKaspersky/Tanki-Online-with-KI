const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Evaluate the real TS module with stubbed Electron types and no Electron runtime.
const source = fs.readFileSync(path.resolve(__dirname, '../src/kiGameGate.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, URL });
const { isKiGameBundleRequest, installKiGameGate } = moduleExports;
const bundle = 'https://s.eu.tankionline.com/static/js/main.289a5d50.js';

test('redirects game bundle script and worker fetch types', () => {
    for (const type of ['script','xhr','other']) {
        assert.equal(isKiGameBundleRequest({ url:bundle, resourceType:type, method:'GET' }), true);
    }
    assert.equal(isKiGameBundleRequest({
        url:'https://test-ru.tankionline.com/browser-public/static/js/main.a_1.js',
        resourceType:'script', method:'GET'
    }), true);
});

test('does not redirect native fallback, query URLs, unrelated servers, or POSTs', () => {
    for (const url of [
        bundle+'?ki_native=1', bundle+'?v=3', bundle.replace('/main.','/vendor.'),
        bundle.replace('s.eu.','evil.'), bundle.replace('tankionline.com','example.com'),
        bundle.replace('https:', 'file:')
    ]) assert.equal(isKiGameBundleRequest({url,resourceType:'script',method:'GET'}),false,url);
    for (const resourceType of ['image','stylesheet','mainFrame']) {
        assert.equal(isKiGameBundleRequest({url:bundle,resourceType}), false);
    }
    assert.equal(isKiGameBundleRequest({url:bundle,resourceType:'xhr',method:'POST'}),false);
});

test('registers one redirect handler on the game session', () => {
    let filter, listener;
    const reports = [];
    const ses = {webRequest:{onBeforeRequest(f,cb){filter=f;listener=cb;}}};
    const id = 'a'.repeat(32);
    const gate = installKiGameGate(ses,id,(url,type)=>reports.push([url,type]));
    assert.equal(gate,`chrome-extension://${id}/dist/kasp_game_gate.js`);
    assert.deepEqual(JSON.parse(JSON.stringify(filter)),{urls:['*://*.tankionline.com/*']});
    let response;
    listener({url:bundle,resourceType:'script'},result=>response=result);
    assert.deepEqual(JSON.parse(JSON.stringify(response)),{redirectURL:gate});
    listener({url:bundle+'?ki_native=1',resourceType:'xhr'},result=>response=result);
    assert.deepEqual(JSON.parse(JSON.stringify(response)),{});
    assert.deepEqual(reports,[[bundle,'script']]);
});

test('rejects invalid extension identity',()=>{
    assert.throws(()=>installKiGameGate({webRequest:{onBeforeRequest(){}}},'bad'),/extension ID/);
});
