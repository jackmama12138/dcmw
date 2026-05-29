// server.js
const http = require('http');
const { WebSocketServer } = require('ws');

// 1. 创建 HTTP 服务，托管测控网页面板
const server = http.createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
	res.end(getHtmlPage());
});

// 2. 绑定 WebSocket 服务
const wss = new WebSocketServer({ server });
const clients = new Map(); // 存储自动化运行实例的 WS 连接

console.log('🚀 测控中心已全面启动！');
console.log('👉 请使用浏览器打开: http://127.0.0.1:8080 面板进行实时测控');

wss.on('connection', (ws) => {

	// 监听所有客户端发来的消息
	ws.on('message', (message) => {
		try {
			// 确保把 Buffer 强转为标准的 utf-8 字符串
			const msgStr = message.toString('utf-8');
			const data = JSON.parse(msgStr);

			// 处理网络请求拦截的上报转发（只负责发，不负责在后端渲染）
			if (data.__control_type === 'request_detected') {
				console.log(`📡 [中枢转发] 抓取到来自 [${data.profile}] 的流量回传，正在广播给网页端...`);
				let panelCount = 0;
				wss.clients.forEach(client => {
					if (client.readyState === 1 && client.isPanel) {
						console.log(JSON.stringify(data))
						client.send(JSON.stringify(data)); // ✨ 转手扔给前端网页
						panelCount++;
					}
				});
				console.log(`   -> 已成功同步给 ${panelCount} 个测控网页`);
				return;
			}

			// 处理网页控制端连入时的注册标记
			if (data.type === 'register_panel') {
				ws.isPanel = true;
				console.log(`🌐 测控网页前端已成功接入控制总线`);
				ws.send(JSON.stringify({ __control_type: 'update_clients', clients: Array.from(clients.keys()) }));
				return;
			}

			// 处理自动化客户端(run.js)的注册上线
			if (data.type === 'register') {
				ws.isRunner = true;
				clients.set(data.profile, ws);
				console.log(`✅ 自动化实例 [${data.profile}] 已成功连接上线`);
				broadcastOnlineClients();
				return;
			}

			// 处理从前端网页端发来的控制指令路由转发
			if (data.__to_profile) {
				const targetWs = clients.get(data.__to_profile);
				if (targetWs && targetWs.readyState === 1) {
					const profileName = data.__to_profile;
					delete data.__to_profile;
					targetWs.send(JSON.stringify(data));
					console.log(`➡️  指令已成功路由转发给 -> [${profileName}]:`, data.type);
				} else {
					console.log(`⚠️  转发失败，实例 [${data.__to_profile}] 可能已离线`);
				}
				return;
			}

		} catch (e) {
			console.error('❌ [中枢严重错误] 收到无法解析的消息流，错误信息:', e.message);
		}
	});

	// 处理断开连接
	ws.on('close', () => {
		for (let [profile, client] of clients.entries()) {
			if (client === ws) {
				clients.delete(profile);
				console.log(`❌ 自动化实例 [${profile}] 断开连接下线`);
				broadcastOnlineClients();
				break;
			}
		}
	});
});

// 广播当前所有在线的自动化实例列表给【纯网页控制端】
function broadcastOnlineClients() {
	const onlineList = Array.from(clients.keys());
	wss.clients.forEach(client => {
		if (client.readyState === 1 && client.isPanel) {
			client.send(JSON.stringify({ __control_type: 'update_clients', clients: onlineList }));
		}
	});
}

// 监听 8080 端口
server.listen(8080);

// ─── 前端可视化图形控制面板 HTML ───
function getHtmlPage() {
	return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>⚡ 自动化动态实时测控面板</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f7fa; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
        h2 { margin-top: 0; color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-weight: bold; margin-bottom: 8px; color: #4a5568; }
        select, input, textarea { width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
        select:focus, input:focus, textarea:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .btn { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: bold; width: 100%; transition: background 0.2s; }
        .btn:hover { background: #2563eb; }
        .status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-top: 5px; }
        .online { background: #dcfce7; color: #166534; }
        .offline { background: #fee2e2; color: #991b1b; }
        .log-box { background: #1e1e1e; color: #7cfc00; padding: 15px; border-radius: 6px; font-family: monospace; height: 180px; overflow-y: auto; margin-top: 20px; font-size: 13px; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="container">
        <h2>⚡ 自动化动态多实例控制面板</h2>
        
        <div class="form-group">
            <label>1. 选择目标浏览器 Profile 实例：</label>
            <select id="profileSelect">
                <option value="">-- 暂无在线实例，请启动 run.js 刷新 --</option>
            </select>
            <div id="wsStatus" class="status-badge offline">未连接控制中心</div>
        </div>

        <div class="form-group">
            <label>2. 选择要调用的功能动作 (Action)：</label>
            <select id="actionSelect" onchange="onActionChange()">
                <option value="navigate">navigate (页面跳转)</option>
                <option value="click">click (模拟人类真实点击)</option>
                <option value="scroll">scroll (页面滑动)</option>
                <option value="wait">wait (随机休眠等待)</option>
                <option value="dwell">dwell (页面特定时长停留)</option>
                <option value="close">close (关闭并释放浏览器)</option>
                <option value="waitForRequest">waitForRequest (等待指定网络请求出现)</option>
                <option value="injectJS">injectJS (自定义JS注入执行)</option>
				<option value="controlVideo">controlVideo (检测并控制网页视频)</option>
            </select>
        </div>

        <div class="form-group">
            <label>3. 填充函数执行参数 (JSON 模版已自动适配)：</label>
            <textarea id="paramJson" rows="5">{\n  "url": "https://www.baidu.com"\n}</textarea>
        </div>

        <button class="btn" onclick="sendCommand()">🚀 发送实时测控指令</button>

        <h3>📜 测控操作日志：</h3>
        <div id="logBox" class="log-box">面板加载成功。等待实例上线...</div>
    </div>

    <script>
       const templates = {
           navigate: "{\\n  \\"url\\": \\"https://www.baidu.com\\"\\n}",
           click: "{\\n  \\"selector\\": \\"input[type='submit']\\",\\n  \\"timeout\\": 5000\\n}",
           scroll: "{\\n  \\"x\\": 0,\\n  \\"y\\": 500\\n}",
           wait: "{\\n  \\"min\\": 1000,\\n  \\"max\\": 3000\\n}",
           dwell: "{}",
           close: "{}",
           waitForRequest: '{\\n  "urlKeyword": "api/v1",\\n  "timeout": 15000\\n}',
           injectJS: '{\\\\n  "script": "console.log(\\'注入成功！\\'); return { title: document.title, cookies: document.cookie };",\\\\n  "arg": null\\\\n}',
		    // ✨ 新增视频控制模版（可选参数: pause 暂停，play 播放）
		    controlVideo: '{\\\\n  "actionType": "pause"\\\\n}'
       };

        function onActionChange() {
            const act = document.getElementById('actionSelect').value;
            document.getElementById('paramJson').value = templates[act] || '{}';
        }

        const ws = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host);
        const logBox = document.getElementById('logBox');

        // 前端的日志打印函数，支持渲染带有色彩样式的 HTML 标签
        function writeLog(msg) {
            logBox.innerHTML += '<div>[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>';
            logBox.scrollTop = logBox.scrollHeight;
        }

        ws.onopen = () => {
            document.getElementById('wsStatus').className = 'status-badge online';
            document.getElementById('wsStatus').innerText = '控制中心联通正常';
            writeLog('成功接入后台控制总线！');
            ws.send(JSON.stringify({ type: 'register_panel' }));
        };

        // ✨ 真正的网页前端消息接收器，完美处理数据展示
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 1. 渲染实例列表
                if (data.__control_type === 'update_clients') {
                    const select = document.getElementById('profileSelect');
                    select.innerHTML = '';
                    if (!data.clients || data.clients.length === 0) {
                        select.innerHTML = '<option value="">-- 暂无在线实例，请启动 run.js 刷新 --</option>';
                        return;
                    }
                    data.clients.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c;
                        opt.innerText = '🟢 活跃多开实例：' + c;
                        select.appendChild(opt);
                    });
                    writeLog('🔄 活跃浏览器实例列表已更新，当前在线: ' + data.clients.join(', '));
                    return;
                }

                // 2. ✨ 实时在网页日志框上高亮渲染截获到的网络请求
                if (data.__control_type === 'request_detected') {
                    if (data.method === 'TIMEOUT') {
                        writeLog('<span style="color: #ff9900; font-weight: bold;">⚠️ [' + data.profile + '] ' + data.url + '</span>');
                    } else {
                        writeLog('<span style="color: #5cfc00; font-weight: bold;">📡 [' + data.profile + '] 拦截成功! URL -> </span> <a href="' + data.url + '" target="_blank" style="color: #00bfff; text-decoration: underline;">' + data.url + '</a>');
                    }
                    return;
                }
            } catch(e){
                console.error('前端解析数据发生异常:', e);
            }
        };

        ws.onclose = () => {
            document.getElementById('wsStatus').className = 'status-badge offline';
            document.getElementById('wsStatus').innerText = '控制总线掉线';
        };

        function sendCommand() {
            const profile = document.getElementById('profileSelect').value;
            if (!profile) {
                alert('请选择一个有效的在线自动化浏览器实例！');
                return;
            }
            const type = document.getElementById('actionSelect').value;
            let params = {};
            try {
                params = JSON.parse(document.getElementById('paramJson').value);
            } catch(e) {
                alert('JSON 参数配置格式不正确！');
                return;
            }

            const payload = {
                __to_profile: profile,
                type: type,
                ...params
            };

            ws.send(JSON.stringify(payload));
            writeLog('➡️ 指令已投递 -> Target: ' + profile + ' | Action: ' + type);
        }
    </script>
</body>
</html>
`;
}