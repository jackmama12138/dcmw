const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE = { IDLE: 'idle', BUSY: 'busy', ERROR: 'error' };

class ChromePool {
  constructor({ chromePath, profilesBaseDir, profileNames }) {
    if (!chromePath) throw new Error('ChromePool: chromePath is required');
    if (!profilesBaseDir) throw new Error('ChromePool: profilesBaseDir is required');
    if (!Array.isArray(profileNames) || profileNames.length === 0) {
      throw new Error('ChromePool: profileNames must be a non-empty array');
    }

    this.chromePath = chromePath;
    this.profilesBaseDir = profilesBaseDir;
    this.profileNames = profileNames;
    // Map<profileName, { state: STATE, context: BrowserContext|null }>
    this.slots = new Map();
  }

  init() {
    for (const name of this.profileNames) {
      this.slots.set(name, { state: STATE.IDLE, context: null, releasing: false });
    }
    logger.info(`ChromePool ready — profiles: [${this.profileNames.join(', ')}]`);
  }

  stats() {
    const result = { idle: 0, busy: 0, error: 0, total: this.slots.size };
    for (const { state } of this.slots.values()) {
      result[state] = (result[state] ?? 0) + 1;
    }
    return result;
  }

  idleProfiles() {
    return [...this.slots.entries()]
      .filter(([, s]) => s.state === STATE.IDLE)
      .map(([name]) => name);
  }

  // Acquire a slot and launch Chrome. Throws if the slot is not idle.
  async acquire(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot) throw new Error(`ChromePool: unknown profile "${profileName}"`);
    if (slot.state !== STATE.IDLE) {
      throw new Error(`ChromePool: profile "${profileName}" is ${slot.state}`);
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

      // Fix ①: launchPersistentContext returns a BrowserContext, not a Browser.
      // context.browser() is null for persistent contexts — listen on context directly.
      context.on('close', () => {
        // Ignore intentional closes triggered by pool.release() or the close() pipeline action.
        if (slot.state === STATE.BUSY && !slot.releasing) {
          logger.warn(`[${profileName}] browser context closed unexpectedly`);
          slot.state = STATE.ERROR;
          slot.context = null;
        }
      });

      slot.context = context;
      logger.info(`[${profileName}] Chrome launched`);
      return context;
    } catch (err) {
      slot.state = STATE.ERROR;
      throw err;
    }
  }

  // Release a slot: close context and mark idle.
  async release(profileName) {
    const slot = this.slots.get(profileName);
    if (!slot) return;

    if (slot.context) {
      await this._saveWindowState(profileName, slot.context);
      slot.releasing = true;
      try {
        const pages = slot.context.pages();
        await Promise.allSettled(pages.map(p => p.close()));
        await slot.context.close();
      } catch (err) {
        logger.warn(`[${profileName}] error during release: ${err.message}`);
      }
      slot.releasing = false;
      slot.context = null;
    }

    slot.state = STATE.IDLE;
    logger.info(`[${profileName}] released → idle`);
  }

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

  async _saveWindowState(profileName, context) {
    try {
      const pages = context.pages();
      if (!pages.length) return;
      const state = await pages[0].evaluate(() => ({
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
      }));
      if (state.width <= 100 || state.height <= 100) return;
      const p = path.join(this.profilesBaseDir, profileName, '.window-state.json');
      fs.writeFileSync(p, JSON.stringify(state));
    } catch (err) {
      logger.warn(`[${profileName}] save window state: ${err.message}`);
    }
  }

  async shutdown() {
    logger.info('ChromePool shutting down...');
    await Promise.allSettled(
      [...this.slots.keys()].map(name => this.release(name))
    );
    logger.info('ChromePool shutdown complete');
  }
}

module.exports = ChromePool;
