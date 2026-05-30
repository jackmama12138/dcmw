const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE = { IDLE: 'idle', BUSY: 'busy', ERROR: 'error' };

class ChromePool {
  constructor({ chromePath, profilesBaseDir, profileNames }) {
    if (!chromePath) throw new Error('ChromePool: chromePath 是必填项');
    if (!profilesBaseDir) throw new Error('ChromePool: profilesBaseDir 是必填项');
    if (!Array.isArray(profileNames) || profileNames.length === 0) {
      throw new Error('ChromePool: profileNames 必须是非空数组');
    }

    this.chromePath = chromePath;
    this.profilesBaseDir = profilesBaseDir;
    this.profileNames = profileNames;
    // Map<profileName, { state: STATE, context: BrowserContext|null }>
    this.slots = new Map();
  }

  // 初始化所有 Profile 槽位为空闲状态
  init() {
    for (const name of this.profileNames) {
      this.slots.set(name, { state: STATE.IDLE, context: null, releasing: false });
    }
    logger.info(`ChromePool 已就绪 — Profile 列表: [${this.profileNames.join(', ')}]`);
  }

  // 返回各状态的槽位统计
  stats() {
    const result = { idle: 0, busy: 0, error: 0, total: this.slots.size };
    for (const { state } of this.slots.values()) {
      result[state] = (result[state] ?? 0) + 1;
    }
    return result;
  }

  // 返回所有空闲 Profile 名称列表
  idleProfiles() {
    return [...this.slots.entries()]
      .filter(([, s]) => s.state === STATE.IDLE)
      .map(([name]) => name);
  }

  // 获取槽位并启动 Chrome，若槽位非空闲则抛出异常
  async acquire(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot) throw new Error(`ChromePool: 未知 Profile "${profileName}"`);
    if (slot.state !== STATE.IDLE) {
      throw new Error(`ChromePool: Profile "${profileName}" 当前状态为 ${slot.state}`);
    }

    slot.state = STATE.BUSY;

    const userDataDir = path.join(this.profilesBaseDir, profileName);
    const winState = this._loadWindowState(profileName);
    const winArgs = winState
      ? [`--window-size=${winState.width},${winState.height}`, `--window-position=${winState.x},${winState.y}`]
      : [];

    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: this.chromePath,
        headless: false,
        viewport: null,
        args: ['--no-first-run', '--no-default-browser-check', ...winArgs],
      });

      // launchPersistentContext 返回 BrowserContext 而非 Browser
      // context.browser() 对持久化 context 为 null，直接监听 context 的 close 事件
      context.on('close', () => {
        // 忽略由 pool.release() 或 close() 动作触发的主动关闭
        if (slot.state === STATE.BUSY && !slot.releasing) {
          logger.warn(`[${profileName}] Chrome context 意外关闭`);
          slot.state = STATE.ERROR;
          slot.context = null;
        }
      });

      slot.context = context;
      logger.info(`[${profileName}] Chrome 已启动`);
      return context;
    } catch (err) {
      slot.state = STATE.ERROR;
      throw err;
    }
  }

  // 释放槽位：关闭 context 并将状态置为空闲
  async release(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot) return;

    if (slot.context) {
      await this._saveWindowState(profileName, slot.context);
      slot.releasing = true;
      try {
        // 修复：用变量持有定时器句柄，context.close() 完成后及时清除，避免定时器泄漏
        let closeTimeoutHandle;
        const closeTimeout = new Promise((_, reject) => {
          closeTimeoutHandle = setTimeout(() => reject(new Error('关闭超时')), 8000);
        });
        const pages = slot.context.pages();
        await Promise.allSettled(pages.map(p => p.close()));
        await Promise.race([
          slot.context.close().then(() => { clearTimeout(closeTimeoutHandle); }),
          closeTimeout,
        ]);
      } catch (err) {
        logger.warn(`[${profileName}] 释放时出错: ${err.message}`);
      }
      slot.releasing = false;
      slot.context = null;
    }

    slot.state = STATE.IDLE;
    logger.info(`[${profileName}] 已释放 → 空闲`);
  }

  // 获取所有繁忙槽位当前页面的 URL 和标题
  async getActivePageInfo() {
    const result = {};
    for (const [name, slot] of this.slots) {
      if (slot.state !== STATE.BUSY || !slot.context) continue;
      try {
        const pages = slot.context.pages();
        if (!pages.length) continue;
        const page = pages[0];
        const url = page.url();
        const title = await page.title().catch(() => '');
        result[name] = { url, title };
      } catch {}
    }
    return result;
  }

  // 从磁盘加载上次保存的窗口位置和尺寸
  _loadWindowState(profileName) {
    try {
      const p = path.join(this.profilesBaseDir, profileName, '.window-state.json');
      if (!fs.existsSync(p)) return null;
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (s.width > 100 && s.height > 100) return s;
      return null;
    } catch {
      return null;
    }
  }

  // 将当前窗口位置和尺寸持久化到磁盘
  async _saveWindowState(profileName, context) {
    try {
      const pages = context.pages();
      if (!pages.length) return;
      let saveTimeoutHandle;
      const timeout = new Promise((_, reject) => {
        saveTimeoutHandle = setTimeout(() => reject(new Error('evaluate 超时')), 5000);
      });
      const state = await Promise.race([
        pages[0].evaluate(() => ({
          x: window.screenX,
          y: window.screenY,
          width: window.outerWidth,
          height: window.outerHeight,
        })).then(s => { clearTimeout(saveTimeoutHandle); return s; }),
        timeout,
      ]);
      if (state.width <= 100 || state.height <= 100) return;
      const p = path.join(this.profilesBaseDir, profileName, '.window-state.json');
      fs.writeFileSync(p, JSON.stringify(state));
    } catch (err) {
      logger.warn(`[${profileName}] 保存窗口状态失败: ${err.message}`);
    }
  }

  // 优雅关闭所有槽位
  async shutdown() {
    logger.info('ChromePool 正在关闭...');
    await Promise.allSettled(
      [...this.slots.keys()].map(name => this.release(name))
    );
    logger.info('ChromePool 已关闭');
  }
}

module.exports = ChromePool;
