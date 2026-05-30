const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE = { IDLE: 'idle', BUSY: 'busy', ERROR: 'error' };

class ChromePool {
  constructor({ chromePath, profilesBaseDir, profileNames, onUnexpectedClose }) {
    if (!chromePath) throw new Error('ChromePool: chromePath 是必填项');
    if (!profilesBaseDir) throw new Error('ChromePool: profilesBaseDir 是必填项');
    if (!Array.isArray(profileNames) || profileNames.length === 0) {
      throw new Error('ChromePool: profileNames 必须是非空数组');
    }

    this.chromePath = chromePath;
    this.profilesBaseDir = profilesBaseDir;
    this.profileNames = profileNames;
    this.onUnexpectedClose = onUnexpectedClose ?? (() => {});
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
  // 懒关闭模式：若 context 已存在则直接复用，无需重新启动
  async acquire(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot) throw new Error(`ChromePool: 未知 Profile "${profileName}"`);
    if (slot.state !== STATE.IDLE) {
      throw new Error(`ChromePool: Profile "${profileName}" 当前状态为 ${slot.state}`);
    }

    // 清除懒关闭定时器，复用已有 context
    if (slot._idleTimer) {
      clearTimeout(slot._idleTimer);
      slot._idleTimer = null;
    }
    if (slot.context) {
      slot.state = STATE.BUSY;
      logger.info(`[${profileName}] 复用已有 Chrome context`);
      return slot.context;
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
          slot.state = STATE.IDLE;
          slot.context = null;
          this.onUnexpectedClose(profileName);
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

  // 释放槽位：懒关闭模式下保留 context，导航到空白页等待复用
  // forceClose=true 时才真正关闭 Chrome（进程退出或长期空闲时使用）
  async release(profileName, { forceClose = false } = {}) {
    const slot = this.slots.get(profileName);
    if (!slot) return;

    if (slot.context && !forceClose) {
      // 懒关闭：保存窗口状态，导航到空白页，启动空闲计时器
      await this._saveWindowState(profileName, slot.context);
      try {
        const pages = slot.context.pages();
        if (pages.length > 0) await pages[0].goto('about:blank').catch(() => {});
      } catch {}
      slot.state = STATE.IDLE;
      logger.info(`[${profileName}] 已释放 → 空闲（Chrome 保留）`);

      // 10分钟无任务则真正关闭，释放内存
      slot._idleTimer = setTimeout(() => this._forceClose(profileName), 10 * 60 * 1000);
      return;
    }

    // 真正关闭 Chrome
    if (slot._idleTimer) {
      clearTimeout(slot._idleTimer);
      slot._idleTimer = null;
    }
    if (slot.context) {
      await this._saveWindowState(profileName, slot.context);
      slot.releasing = true;
      try {
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
        logger.warn(`[${profileName}] 关闭时出错: ${err.message}`);
      }
      slot.releasing = false;
      slot.context = null;
    }

    slot.state = STATE.IDLE;
    logger.info(`[${profileName}] 已释放 → 空闲（Chrome 已关闭）`);
  }

  // 强制关闭指定槽位的 Chrome（空闲超时触发）
  async _forceClose(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot || slot.state !== STATE.IDLE) return;
    logger.info(`[${profileName}] 空闲超时，关闭 Chrome 释放内存`);
    await this.release(profileName, { forceClose: true });
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

  // 优雅关闭所有槽位（进程退出时调用，强制关闭所有 Chrome）
  async shutdown() {
    logger.info('ChromePool 正在关闭...');
    await Promise.allSettled(
      [...this.slots.keys()].map(name => this.release(name, { forceClose: true }))
    );
    logger.info('ChromePool 已关闭');
  }
}

module.exports = ChromePool;
