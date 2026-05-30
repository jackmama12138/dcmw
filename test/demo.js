const { chromium } = require('playwright');
const path = require("path");
const fs = require("fs");

const MAC_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILES_BASE_DIR = "/Users/showmaker/ChromeProfiles";

let globalContext = null;
let globalPage = null;
let currentProfile = '';

/**
 * 核心黑客清洗：不仅洗白崩溃状态，还要洗掉沙盒警告的历史残留缓存
 */
function fixChromeCrashAndWarningState(profileName) {
	const preferencesPath = path.join(CHROME_PROFILES_BASE_DIR, profileName, 'Default', 'Preferences');

	if (fs.existsSync(preferencesPath)) {
		try {
			let config = JSON.parse(fs.readFileSync(preferencesPath, 'utf-8'));

			// 1. 洗白崩溃状态（防止弹出恢复提示）
			if (config.profile) {
				if (config.profile.exit_type) config.profile.exit_type = "Normal";
				if (config.profile.exited_cleanly !== undefined) config.profile.exited_cleanly = true;
			}

			// 2. 【核心卡位】硬核清洗 infobars 和 bad_flags 的历史缓存记录
			// Chrome 会把不受支持的标记记录在 preferences 的 browser 或 apps 节点中
			if (config.browser) {
				// 清空警告栏相关的历史缓存状态
				if (config.browser.infobar_counts) config.browser.infobar_counts = {};
				if (config.browser.has_seen_bad_flags !== undefined) config.browser.has_seen_bad_flags = false;
			}

			// 确保彻底抹掉 profile 级别的警告印记
			if (config.profile && config.profile.reset_infobars) {
				config.profile.reset_infobars = true;
			}

			// 同步写回文件，赶在 Chrome 引擎初始化读取之前将其拦截洗白
			fs.writeFileSync(preferencesPath, JSON.stringify(config), 'utf-8');
		} catch (e) {
			// 忽略文件解析异常
		}
	}
}

function getStoredLayout(profileName) {
	const configFile = path.join(CHROME_PROFILES_BASE_DIR, `${profileName}_layout.json`);
	const defaultLayout = { x: 100, y: 100, width: 1280, height: 720 };
	if (fs.existsSync(configFile)) {
		try {
			const data = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
			if (data.width && data.height) return data;
		} catch (e) {
			return defaultLayout;
		}
	}
	return defaultLayout;
}

function saveCurrentLayout(profileName, layout) {
	const configFile = path.join(CHROME_PROFILES_BASE_DIR, `${profileName}_layout.json`);
	try {
		fs.writeFileSync(configFile, JSON.stringify(layout, null, 2), 'utf-8');
	} catch (e) {
		console.error("写入记忆文件失败:", e.message);
	}
}

async function updateLayoutNow() {
	if (!globalPage || globalPage.isClosed()) return;
	try {
		const layout = await globalPage.evaluate(() => {
			return {
				x: window.screenX,
				y: window.screenY,
				width: window.outerWidth || window.innerWidth,
				height: window.outerHeight || window.innerHeight
			};
		});
		if (layout.width > 100 && layout.height > 100) {
			saveCurrentLayout(currentProfile, layout);
		}
	} catch (e) {}
}

async function init(profileName) {
	currentProfile = profileName;

	// 【关键修复 1】启动前强制进行本地 Preferences 全量大扫除，洗掉不安全标记缓存
	fixChromeCrashAndWarningState(profileName);

	const userDataDir = path.join(CHROME_PROFILES_BASE_DIR, profileName);
	const layout = getStoredLayout(profileName);

	console.log(`[${profileName}] 正在恢复历史记忆位置 -> X:${layout.x}, Y:${layout.y}, W:${layout.width}, H:${layout.height}`);

	globalContext = await chromium.launchPersistentContext(userDataDir, {
		executablePath: MAC_CHROME_PATH,
		headless: false,
		viewport: null, // 保持纯净的拉伸记忆

		// 【关键修复 2】全量重写 args，绝对不能留有任何 sandbox 相关的残留
		args: [
			'--no-first-run',
			`--window-size=${layout.width},${layout.height}`,
			`--window-position=${layout.x},${layout.y}`,
			'--disable-blink-features=AutomationControlled',

			// ─── 终极切除术：四大黑客命令行标记 ─────────────────────────────────────
			'--disable-infobars',               // 物理切断所有内置信息条（强行让通知组件不初始化）
			'--hide-crash-restore-bubble',     // 隐藏崩溃恢复气泡
			'--disable-session-crashed-bubble', // 禁用会话崩溃气泡
			'--no-default-browser-check',       // 屏蔽默认浏览器检查
			'--log-level=3'                     // 只打印严重错误，对自动化运行时产生的警告进行静默降噪
		],
	});

	globalPage = globalContext.pages().length > 0 ? globalContext.pages()[0] : await globalContext.newPage();

	const autoSaveTimer = setInterval(async () => {
		await updateLayoutNow();
	}, 1000);

	try {
		await globalPage.goto('https://live.douyin.com', { waitUntil: 'commit' });
		console.log(`[${profileName}] 界面清洗完毕。历史沙盒警告条已成功物理切除。可以使用 Ctrl+C 安全退出。`);
		// await globalPage.

	} catch (error) {
		console.error("执行失败:", error.message);
		clearInterval(autoSaveTimer);
	}
}

process.on('SIGINT', async () => {
	console.log('\n[Livetop 守护] 检测到退出信号 (Ctrl+C)，正在进行最后的数据落盘...');
	if (globalPage && globalContext) {
		await updateLayoutNow();
		await globalContext.close().catch(() => {});
	}
	console.log('[Livetop 守护] 状态清理完毕，安全退出。');
	process.exit(0);
});

init('Profile6');