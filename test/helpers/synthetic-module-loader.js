'use strict';

// Executes the actual source with explicit infrastructure doubles. No socket,
// database connection, or application listener is permitted by this loader.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ROOT = path.resolve(__dirname, '../..');

function createLoader({ env = {}, database = {}, labels = {}, overrides = {} } = {}) {
  const modules = new Map();
  const requests = [];
  const db = {
    dbGet: async () => null,
    dbRun: async () => ({}),
    dbAll: async () => [],
    getAllClinicalRules: async () => [],
    createSuggestion: async () => ({ id: 1 }),
    ...database
  };
  const https = {
    get(url, _options, callback) {
      requests.push(url);
      if (!url.startsWith('https://api.fda.gov/drug/label.json?')) {
        throw new Error('Unexpected outbound request: ' + url);
      }
      const res = new EventEmitter();
      const req = new EventEmitter();
      req.destroy = () => {};
      callback(res);
      queueMicrotask(() => {
        const body = typeof labels === 'function' ? labels(url) : labels;
        res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
      return req;
    }
  };
  function load(relative) {
    relative = relative.replace(/\\/g, '/');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep)) throw new Error('Module outside repository');
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (file === path.join(ROOT, 'server/database.js')) return db;
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const requireDouble = specifier => {
      if (specifier === 'https' || specifier === 'node:https') return https;
      if (['events', 'crypto', 'path'].includes(specifier)) return require('node:' + specifier);
      if (!specifier.startsWith('.')) throw new Error('Unapproved dependency: ' + specifier);
      let next = path.resolve(path.dirname(file), specifier);
      if (!path.extname(next)) next += '.js';
      return load(path.relative(ROOT, next));
    };
    const fn = vm.runInNewContext('(function(require,module,exports,__filename,__dirname){\n'
      + fs.readFileSync(file, 'utf8') + '\n})', {
      process: { env }, console: { warn() {}, log() {}, error() {} },
      setTimeout, clearTimeout, Buffer
    }, { filename: file });
    fn(requireDouble, module, module.exports, file, path.dirname(file));
    return module.exports;
  }
  return { load, requests, database: db };
}

module.exports = { createLoader };
