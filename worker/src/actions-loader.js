const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Built-in actions are bundled at this path (read-only in packaged builds).
const BUILTIN_PATH = path.resolve(__dirname, 'actions.js');

// Override file lives outside the bundle so it survives packaging and hot-reload.
// Default: <cwd>/actions.override.js  (configurable via ACTIONS_OVERRIDE_PATH env).
const OVERRIDE_PATH = process.env.ACTIONS_OVERRIDE_PATH
  ? path.resolve(process.env.ACTIONS_OVERRIDE_PATH)
  : path.resolve(process.cwd(), 'actions.override.js');

let _current = null;

function _loadBuiltin() {
  delete require.cache[BUILTIN_PATH];
  _current = require(BUILTIN_PATH);
  logger.info('actions.js: loaded built-in');
}

function _loadOverride() {
  delete require.cache[OVERRIDE_PATH];
  _current = require(OVERRIDE_PATH);
  logger.info(`actions.js: loaded override from ${OVERRIDE_PATH}`);
}

function _load() {
  if (fs.existsSync(OVERRIDE_PATH)) {
    try {
      _loadOverride();
      return;
    } catch (err) {
      logger.error(`actions.js: override load failed (${err.message}), falling back to built-in`);
    }
  }
  _loadBuiltin();
}

/**
 * Hot-reload actions from new source code pushed by the gateway.
 * Writes to OVERRIDE_PATH (outside the bundle), not to the built-in file.
 * If code is null/empty, deletes the override and reverts to built-in.
 */
function reload(code) {
  if (!code) {
    resetToBuiltin();
    return;
  }
  try {
    fs.mkdirSync(path.dirname(OVERRIDE_PATH), { recursive: true });
    fs.writeFileSync(OVERRIDE_PATH, code, 'utf8');
    _loadOverride();
  } catch (err) {
    logger.error(`actions.js reload failed: ${err.message}`);
  }
}

function resetToBuiltin() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) fs.unlinkSync(OVERRIDE_PATH);
  } catch (err) {
    logger.warn(`actions.js: could not delete override file: ${err.message}`);
  }
  _loadBuiltin();
  logger.info('actions.js: reverted to built-in');
}

function runStep(context, step, ctrl) {
  return _current.runStep(context, step, ctrl);
}

// Initial load on startup.
_load();

module.exports = { reload, resetToBuiltin, runStep };
