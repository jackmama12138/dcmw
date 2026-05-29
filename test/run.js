// run.js
const { chromium } = require('playwright');
const WebSocket = require('ws');
const path = require('path');
const { runStep } = require('./actions'); // 引入底层方法

// ─── 你的配置信息 ───────────────────────────────────────────────────────────
const MAC_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILES_BASE_DIR = "/Users/showmaker/ChromeProfiles";

// 配置你要同时开启和控制的 Profile 数组列表
const PROFILES = ['Profile1'];

// 全局管控句柄，为动作控制函数提供内部条件支持
const ctrlMap = new Map();

async function initBrowserInstance(profileName) {
	const userDataDir = path.join(CHROME_PROFILES_BASE_DIR, profileName);

	console.log(`[${profileName}] 正在拉起独立沙盒浏览器...`);

	// 1. 利用 Playwright 调起带独立环境的持久化浏览器上下文
	const context = await chromium.launchPersistentContext(userDataDir, {
		executablePath: MAC_CHROME_PATH,
		headless: false, // 动态可视化调试必须为 false（看得见才好测试）
		args: [
			'--no-first-run',
			'--window-size=1000,700'
		],
	});

	// 配置初始化控制状态参数
	ctrlMap.set(profileName, { stopped: false, task_time: 60 });

	// 2. 与 WebSocket 服务端中枢建立连接
	const ws = new WebSocket('ws://localhost:8080');

	ws.on('open', () => {
		// 上线即向中枢自报家门
		ws.send(JSON.stringify({ type: 'register', profile: profileName }));
		console.log(`[${profileName}] 连接到控制中枢成功，已就绪接收控制。`);
	});

	// 监听来自中枢的指令
	ws.on('message', async (message) => {
		try {
			const step = JSON.parse(message);
			if (!step || !step.type) return;

			console.log(`[${profileName}] 收到确切业务指令 -> 执行: ${step.type}`);
			const ctrl = ctrlMap.get(profileName);

			// ✨ 核心修复 1：把之前漏掉的实际执行语句补回来！拿到函数的返回值！
			const resultData = await runStep(context, step, ctrl);
			console.log(`[${profileName}] 动作 [${step.type}] 执行完毕。`);

			// 2. 支持将多个新动作的执行结果同步返回给前端展示
			const actionNeedReport = ['waitForRequest', 'injectJS', 'controlVideo'];

			if (actionNeedReport.includes(step.type)) {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({
						__control_type: 'request_detected', // 借用现有的前端高亮渲染通道
						profile: profileName,
						// 如果底层返回了结果就用结果，没有就提示成功
						url: resultData || `⚠️ 动作 [${step.type}] 执行未返回具体数据`,
						method: step.type.toUpperCase() // 将动作名大写作为标签
					}));
					console.log(`[${profileName}] 已向中枢上报 [${step.type}] 的执行结果。`);
				}
			}

			// 3. 如果是 close 指令，稍微延迟 50 毫秒再断开 WS，给上方的 send 留足发包时间
			if (step.type === 'close') {
				console.log(`[${profileName}] 收到关闭指令，等待缓冲区冲刷...`);
				setTimeout(() => {
					console.log(`[${profileName}] 正在主动切断 WS 通信...`);
					ws.close();
				}, 50);
			}
		} catch (err) {
			console.error(`[${profileName}] 动作执行异常失败:`, err.message);
		}
	});

	// ✨ 核心修复 2：把原本注释掉的守卫逻辑解开。防止异常断连导致主进程崩溃死锁
	ws.on('close', () => {
		console.warn(`[${profileName}] 与控制中心断开，5秒后将自动发起重连...`);
		setTimeout(() => initBrowserInstance(profileName), 5000);
	});

	ws.on('error', (err) => {
		console.error(`[${profileName}] 连接通信错误:`, err.message);
	});
}

// ─── 启动总入口 ─────────────────────────────────────────────────────────────
console.log('🏁 正在批量拉起多 Profile 自动化群控客户端...');
PROFILES.forEach(profile => {
	initBrowserInstance(profile).catch(err => {
		console.error(`❌ 初始化实例 [${profile}] 失败:`, err.message);
	});
});