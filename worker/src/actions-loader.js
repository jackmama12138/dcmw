const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

// 内置动作文件路径（随二进制发布，不热更新）
const BUILTIN_PATH = path.resolve(__dirname, 'actions.js');

// 插件目录：每个 .js 文件是一个独立业务插件，可独立热更新
const PLUGINS_DIR = process.env.PLUGINS_DIR
  ? path.resolve(process.env.PLUGINS_DIR)
  : path.resolve(process.cwd(), 'plugins');

// 合并后的全局动作表，由 _rebuild() 维护
// 优先级：插件（按文件名字母序，后加载覆盖先加载）> 内置
let _actionMap = {};

// ─── 加载辅助 ─────────────────────────────────────────────────────────────────

// 从模块导出中提取 actions 对象，格式：{ actions: { 'type': fn, ... } }
function _extractActions(mod, label) {
  if (mod && typeof mod === 'object' && mod.actions && typeof mod.actions === 'object') {
    return mod.actions;
  }
  logger.warn(`${label}: 无法识别导出格式，已忽略`);
  return {};
}

// 清除 require 缓存并重新加载模块
function _requireFresh(filePath) {
  delete require.cache[filePath];
  return require(filePath);
}

// 加载内置动作，返回 actions 对象
function _loadBuiltin() {
  try {
    const mod     = _requireFresh(BUILTIN_PATH);
    const actions = _extractActions(mod, 'builtin');
    logger.info(`builtin: 加载了 ${Object.keys(actions).length} 个动作`);
    return actions;
  } catch (err) {
    logger.error(`builtin 加载失败: ${err.message}`);
    return {};
  }
}

// 加载插件目录中所有 .js 文件，返回合并后的 actions 对象
function _loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return {};

  let files;
  try {
    files = fs.readdirSync(PLUGINS_DIR)
      .filter(f => f.endsWith('.js'))
      .sort(); // 字母序，保证加载顺序确定
  } catch (err) {
    logger.warn(`plugins 目录读取失败: ${err.message}`);
    return {};
  }

  const merged = {};
  for (const file of files) {
    const filePath = path.join(PLUGINS_DIR, file);
    try {
      const mod     = _requireFresh(filePath);
      const actions = _extractActions(mod, `plugin:${file}`);
      if (actions && actions !== null) {
        Object.assign(merged, actions);
        logger.info(`plugin:${file}: 加载了 ${Object.keys(actions).length} 个动作`);
      }
    } catch (err) {
      logger.error(`plugin:${file} 加载失败: ${err.message}`);
    }
  }
  return merged;
}

// 合并后的 schema 表，与 _actionMap 同步重建
let _schemaMap = {};

// 重建全局 actionMap：builtin → plugins（后者覆盖前者）
function _rebuild() {
  const builtin = _loadBuiltin();
  const plugins = _loadPlugins();

  _actionMap = { ...builtin, ...plugins };

  // 收集插件导出的 schemas（builtin 无 schema，只收插件）
  _schemaMap = {};
  if (fs.existsSync(PLUGINS_DIR)) {
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js')).sort();
    for (const file of files) {
      try {
        const mod = require(path.join(PLUGINS_DIR, file));
        if (mod && mod.schemas && typeof mod.schemas === 'object') {
          Object.assign(_schemaMap, mod.schemas);
        }
      } catch {}
    }
  }

  logger.info(`actionMap 已重建：共 ${Object.keys(_actionMap).length} 个动作，${Object.keys(_schemaMap).length} 个插件 schema`);
}

// ─── 插件热更新 API ───────────────────────────────────────────────────────────

// 写入插件代码并重新加载
// name: 插件名（不含 .js 后缀），code: JS 源码字符串
function loadPlugin(name, code) {
  if (!name || typeof name !== 'string' || !/^[\w-]+$/.test(name)) {
    logger.error(`loadPlugin: 无效的插件名 "${name}"`);
    return false;
  }
  try {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.writeFileSync(path.join(PLUGINS_DIR, `${name}.js`), code, 'utf8');
    _rebuild();
    logger.info(`plugin:${name}: 热更新成功`);
    return true;
  } catch (err) {
    logger.error(`plugin:${name} 写入失败: ${err.message}`);
    return false;
  }
}

// 删除插件文件并重建 actionMap
function unloadPlugin(name) {
  const filePath = path.join(PLUGINS_DIR, `${name}.js`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      delete require.cache[filePath];
    }
    _rebuild();
    logger.info(`plugin:${name}: 已卸载`);
    return true;
  } catch (err) {
    logger.error(`plugin:${name} 卸载失败: ${err.message}`);
    return false;
  }
}

// 列出当前已加载的所有动作名
function listActions() {
  return Object.keys(_actionMap);
}

// ─── 核心分发 ─────────────────────────────────────────────────────────────────

function runStep(context, step, ctrl) {
  if (!step || typeof step !== 'object') {
    throw new Error(`runStep: 无效的步骤 "${JSON.stringify(step)}"`);
  }
  const { type, ...params } = step;
  if (!type) throw new Error('runStep: 步骤缺少 "type" 字段');

  const fn = _actionMap[type];
  if (!fn) throw new Error(`runStep: 未知的动作类型 "${type}"`);
  return fn(context, params, ctrl);
}

// ─── 启动时初始化 ─────────────────────────────────────────────────────────────
_rebuild();

// 返回所有插件的 schema 定义（供 Worker 上报给 gateway）
function getSchemas() { return { ..._schemaMap }; }

module.exports = { runStep, loadPlugin, unloadPlugin, listActions, getSchemas };
