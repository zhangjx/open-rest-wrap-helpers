const consoleHelper = require('./console');
const paramsHelper = require('./params');
const getterHelper = require('./getter');
const assertHelper = require('./assert');
const restHelper = require('./rest');

module.exports = restapi =>
  ({
    console: consoleHelper(restapi),
    params: paramsHelper(restapi),
    getter: getterHelper(restapi),
    assert: assertHelper(restapi),
    rest: restHelper(restapi),
  });
