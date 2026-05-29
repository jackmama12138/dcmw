const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const ACTIONS_PATH = path.resolve(__dirname, 'actions.js');

let _current = null;

function _load() {
  delete require.cache[ACTIONS_PATH];
  _current = require('./actions');
}

/**
 * Hot-reload actions.js from new source code pushed by the gateway.
 * Writes the code to disk, clears the require cache, and re-requires.
 * In-flight runStep calls that are already executing complete with the old
 * function reference; the next call to runStep picks up the new version.
 * If loading fails the old module is kept and the error is logged.
 */
function reload(code) {
  try {
    fs.writeFileSync(ACTIONS_PATH, code, 'utf8');
    _load();
    logger.info('actions.js reloaded successfully');
  } catch (err) {
    logger.error(`actions.js reload failed: ${err.message}`);
    // Keep _current as-is so workers stay functional with the previous version.
  }
}

function runStep(context, step, ctrl) {
  return _current.runStep(context, step, ctrl);
}

// Initial load from disk on startup.
_load();

module.exports = { reload, runStep };
