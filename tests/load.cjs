const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
module.exports = function load(file, mocks = {}, globals = {}, expose = '') {
    const source = fs.readFileSync(path.resolve(__dirname, '../src', file + '.ts'), 'utf8');
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code + expose, { module, exports: module.exports, Buffer, URL, process, console, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
        require: name => name in mocks ? mocks[name] : name.startsWith('./') ? load(name.slice(2), mocks, globals) : require(name) });
    return module.exports;
};
