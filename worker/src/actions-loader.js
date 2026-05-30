const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// 内置动作文件路径（打包后只读）
const BUILTIN_PATH = path.resolve(__dirname, 'actions.js');

// 覆盖文件位于 bundle 之外，支持热重载和打包后持久化
// 默认路径：<cwd>/actions.override.js，可通过 ACTIONS_OVERRIDE_PATH 环境变量配置
const OVERRIDE_PATH = process.env.ACTIONS_OVERRIDE_PATH
  ? path.resolve(process.env.ACTIONS_OVERRIDE_PATH)
  : path.resolve(process.cwd(), 'actions.override.js');

let _current = null;

// 加载内置动作模块（清除旧缓存后重新 require）
function _loadBuiltin() {
  delete require.cache[BUILTIN_PATH];
  _current = require(BUILTIN_PATH);
  logger.info('actions.js: 已加载内置动作');
}

// 加载覆盖动作文件（清除旧缓存后重新 require）
function _loadOverride() {
  delete require.cache[OVERRIDE_PATH];
  _current = require(OVERRIDE_PATH);
  logger.info(`actions.js: 已从覆盖文件加载: ${OVERRIDE_PATH}`);
}

// 优先尝试加载覆盖文件，失败时回退到内置动作
function _load() {
  if (fs.existsSync(OVERRIDE_PATH)) {
    try {
      _loadOverride();
      return;
    } catch (err) {
      logger.error(`actions.js: 覆盖文件加载失败 (${err.message})，回退到内置动作`);
    }
  }
  _loadBuiltin();
}

// 热重载：将 gateway 推送的新动作代码写入覆盖文件后立即生效
// code 为 null/空 时删除覆盖文件并恢复内置动作
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
    logger.error(`actions.js 热重载失败: ${err.message}`);
  }
}

// 删除覆盖文件并恢复内置动作
function resetToBuiltin() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) fs.unlinkSync(OVERRIDE_PATH);
  } catch (err) {
    logger.warn(`actions.js: 无法删除覆盖文件: ${err.message}`);
  }
  _loadBuiltin();
  logger.info('actions.js: 已恢复内置动作');
}

// 代理到当前加载的动作模块，执行单个 pipeline 步骤
function runStep(context, step, ctrl) {
  return _current.runStep(context, step, ctrl);
}

// 启动时执行初始加载
_load();

module.exports = { reload, resetToBuiltin, runStep };
