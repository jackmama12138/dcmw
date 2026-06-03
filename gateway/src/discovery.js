// 局域网 UDP 发现服务：worker 广播询问，gateway 应答
// worker 从应答的【来源地址】即可得知 gateway IP，无需写死配置
// 前提：worker 与 gateway 在同一子网（UDP 广播不跨子网）
const dgram = require('dgram');
const logger = require('./logger');

const DISCOVERY_PORT = parseInt(process.env.DISCOVERY_PORT ?? '7778', 10);
const MAGIC_REQ  = 'DCMW_DISCOVER';
const MAGIC_RESP = 'DCMW_GATEWAY';

// servicePort: gateway 主服务端口（HTTP/WS），随应答告知 worker
function startDiscovery(servicePort) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('message', (msg, rinfo) => {
    if (msg.toString().trim() !== MAGIC_REQ) return;
    const reply = Buffer.from(`${MAGIC_RESP}:${servicePort}`);
    sock.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) logger.warn(`发现服务应答失败 → ${rinfo.address}: ${err.message}`);
      else logger.info(`发现服务已应答 worker → ${rinfo.address}`);
    });
  });

  sock.on('error', (err) => {
    logger.error(`UDP 发现服务错误: ${err.message}`);
    try { sock.close(); } catch {}
  });

  sock.bind(DISCOVERY_PORT, () => {
    try { sock.setBroadcast(true); } catch {}
    logger.info(`UDP 发现服务已启动，监听 :${DISCOVERY_PORT}（worker 广播 ${MAGIC_REQ} 即可发现本机）`);
  });

  return sock;
}

module.exports = { startDiscovery, DISCOVERY_PORT, MAGIC_REQ, MAGIC_RESP };
