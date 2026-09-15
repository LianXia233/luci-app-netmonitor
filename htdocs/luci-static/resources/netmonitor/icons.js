/*
 * luci-app-netmonitor 动态 SVG 图标库
 *
 * 设计约束：
 *   1. 全部内联绘制，不引用任何外部图标 CDN 或图标字体。
 *   2. 图标随状态变化：同一函数在不同状态下输出不同结构/动画。
 *   3. 动画只作用于 transform / opacity / stroke-dashoffset，
 *      不使用 filter 与 blur，低端设备也能流畅运行。
 */

'use strict';

var NM_COLORS = {
	ok: '#2e9e5b',
	good: '#3aa76d',
	warn: '#d69a1a',
	poor: '#e0762c',
	bad: '#cf4437',
	idle: '#8a93a3',
	accent: '#2f6fed',
	line: 'currentColor'
};

function c(name) {
	return NM_COLORS[name] || NM_COLORS.idle;
}

/* 整体健康状态：正常时节点缓慢脉冲，异常时圆环告警脉冲 */
function health(state, size) {
	var s = size || 72;
	var color = (state === 'good') ? c('ok') :
	            (state === 'warning') ? c('warn') :
	            (state === 'critical') ? c('bad') : c('idle');

	if (state === 'good') {
		return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 72 72" role="img" aria-label="ok">' +
			'<g class="nm-a-pulse" style="transform-origin:36px 36px">' +
				'<circle class="nm-pulse-ring" cx="36" cy="36" r="14" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.5"/>' +
				'<circle class="nm-pulse-ring" cx="36" cy="36" r="14" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.5"/>' +
			'</g>' +
			'<circle cx="36" cy="36" r="11" fill="none" stroke="' + color + '" stroke-width="2.5" opacity="0.85"/>' +
			'<g stroke="' + color + '" stroke-width="2" opacity="0.55">' +
				'<line x1="36" y1="25" x2="36" y2="13"/>' +
				'<line x1="36" y1="47" x2="36" y2="59"/>' +
				'<line x1="25" y1="36" x2="13" y2="36"/>' +
				'<line x1="47" y1="36" x2="59" y2="36"/>' +
			'</g>' +
			'<circle cx="36" cy="11" r="3.2" fill="' + color + '"/>' +
			'<circle cx="36" cy="61" r="3.2" fill="' + color + '"/>' +
			'<circle cx="11" cy="36" r="3.2" fill="' + color + '"/>' +
			'<circle cx="59" cy="36" r="3.2" fill="' + color + '"/>' +
			'<circle cx="36" cy="36" r="4.5" fill="' + color + '"/>' +
			'</svg>';
	}

	if (state === 'critical' || state === 'warning') {
		return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 72 72" role="img" aria-label="alert">' +
			'<circle class="nm-a-alarm" style="transform-origin:36px 36px" cx="36" cy="36" r="20" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.4"/>' +
			'<circle cx="36" cy="36" r="13" fill="none" stroke="' + color + '" stroke-width="2.5"/>' +
			'<rect x="33.4" y="26" width="5.2" height="16" rx="2.6" fill="' + color + '"/>' +
			'<circle cx="36" cy="47.5" r="2.9" fill="' + color + '"/>' +
			'<line x1="36" y1="12" x2="36" y2="17" stroke="' + color + '" stroke-width="2"/>' +
			'<line x1="36" y1="55" x2="36" y2="60" stroke="' + color + '" stroke-width="2"/>' +
			'</svg>';
	}

	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 72 72" role="img" aria-label="unknown">' +
		'<circle cx="36" cy="36" r="18" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="4 6" opacity="0.7"/>' +
		'<circle cx="36" cy="36" r="6" fill="none" stroke="' + color + '" stroke-width="2.5"/>' +
		'</svg>';
}

/* Ping：数据包沿路径移动，速度随延迟/状态变化（越快代表越健康） */
function ping(speed, size) {
	var s = size || 48;
	var cls = 'nm-a-move' + (speed === 'fast' ? ' nm-a-move-fast' : (speed === 'slow' ? ' nm-a-move-slow' : ''));
	var col = (speed === 'fast') ? c('ok') : (speed === 'slow' ? c('warn') : c('accent'));
	return '<svg class="nm-svg nm-a-dash" width="' + s + '" height="' + s + '" viewBox="0 0 48 48" role="img" aria-label="ping">' +
		'<path d="M4 24 H44" fill="none" stroke="currentColor" stroke-width="2" opacity="0.28"/>' +
		'<circle cx="6" cy="24" r="4" fill="none" stroke="' + col + '" stroke-width="2"/>' +
		'<circle cx="42" cy="24" r="5" fill="none" stroke="' + col + '" stroke-width="2"/>' +
		'<g class="' + cls + '"><rect x="0" y="20" width="8" height="8" rx="2" fill="' + col + '"/></g>' +
		'</svg>';
}

/* 延迟：中心数字，四周缓慢扩散的波纹 */
function latency(value, grade, size) {
	var s = size || 64;
	var col = c(grade === 'good' || grade === 'excellent' ? 'ok' :
	            grade === 'fair' ? 'warn' :
	            grade === 'poor' ? 'poor' :
	            grade === 'severe' || grade === 'down' ? 'bad' : 'idle');
	var txt = (value === null || value === undefined) ? '--' : value;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" role="img" aria-label="latency">' +
		'<g class="nm-a-ripple" style="transform-origin:32px 32px">' +
			'<circle cx="32" cy="32" r="18" fill="none" stroke="' + col + '" stroke-width="1.6" opacity="0.5"/>' +
			'<circle cx="32" cy="32" r="18" fill="none" stroke="' + col + '" stroke-width="1.6" opacity="0.5"/>' +
			'<circle cx="32" cy="32" r="18" fill="none" stroke="' + col + '" stroke-width="1.6" opacity="0.5"/>' +
		'</g>' +
		'<circle cx="32" cy="32" r="19" fill="none" stroke="' + col + '" stroke-width="2" opacity="0.65"/>' +
		'<text x="32" y="37" text-anchor="middle" font-size="17" font-weight="650" fill="currentColor">' + txt + '</text>' +
		'</svg>';
}

/* 在线：圆环缓慢旋转 */
function online(size) {
	var s = size || 40;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 40 40" role="img" aria-label="online">' +
		'<g class="nm-a-spin" style="transform-origin:20px 20px">' +
			'<circle cx="20" cy="20" r="14" fill="none" stroke="' + c('ok') + '" stroke-width="3" stroke-dasharray="18 12" stroke-linecap="round"/>' +
		'</g>' +
		'<circle cx="20" cy="20" r="6" fill="' + c('ok') + '" opacity="0.9"/>' +
		'</svg>';
}

/* 国内网络：简洁的节点互联图 */
function regionCN(size) {
	var s = size || 40;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 40 40" role="img" aria-label="cn">' +
		'<g stroke="' + c('accent') + '" stroke-width="1.6" opacity="0.7" fill="none">' +
			'<path d="M20 9 L9 30 L31 30 Z"/>' +
			'<path d="M20 9 L20 30"/>' +
			'<path d="M14.5 19.5 L25.5 19.5"/>' +
		'</g>' +
		'<g class="nm-a-pulse" style="transform-origin:20px 20px">' +
			'<circle class="nm-pulse-ring" cx="20" cy="20" r="5" fill="none" stroke="' + c('accent') + '" stroke-width="1.4"/>' +
		'</g>' +
		'<circle cx="20" cy="9" r="3" fill="' + c('accent') + '"/>' +
		'<circle cx="9" cy="30" r="3" fill="' + c('accent') + '"/>' +
		'<circle cx="31" cy="30" r="3" fill="' + c('accent') + '"/>' +
		'<circle cx="20" cy="20" r="3.4" fill="' + c('accent') + '"/>' +
		'</svg>';
}

/* 国外网络：跨区域连接（两簇节点 + 跨海链路） */
function regionGlobal(size) {
	var s = size || 40;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 40 40" role="img" aria-label="global">' +
		'<circle cx="20" cy="20" r="13" fill="none" stroke="#8a63d2" stroke-width="1.4" opacity="0.55"/>' +
		'<ellipse cx="20" cy="20" rx="6" ry="13" fill="none" stroke="#8a63d2" stroke-width="1.2" opacity="0.45"/>' +
		'<path d="M7 20 H33" stroke="#8a63d2" stroke-width="1.2" opacity="0.45"/>' +
		'<path class="nm-a-dash" d="M9 27 Q20 12 31 27" fill="none" stroke="#8a63d2" stroke-width="1.8" opacity="0.9"/>' +
		'<circle cx="9" cy="27" r="2.8" fill="#8a63d2"/>' +
		'<circle cx="31" cy="27" r="2.8" fill="#8a63d2"/>' +
		'<circle cx="20" cy="8" r="2.4" fill="#8a63d2"/>' +
		'</svg>';
}

/* 丢包：数据包随机消失 */
function packetLoss(size) {
	var s = size || 40;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 40 40" role="img" aria-label="loss">' +
		'<path d="M3 20 H37" stroke="currentColor" stroke-width="1.6" opacity="0.25"/>' +
		'<g class="nm-a-move"><rect x="0" y="16" width="7" height="7" rx="2" fill="' + c('ok') + '"/></g>' +
		'<g class="nm-a-vanish"><rect x="0" y="16" width="7" height="7" rx="2" fill="' + c('bad') + '"/></g>' +
		'<circle cx="37" cy="20" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.5"/>' +
		'</svg>';
}

/* 高延迟：波形逐渐变密/变快 */
function highLatency(size) {
	var s = size || 40;
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 40 40" role="img" aria-label="high">' +
		'<path class="nm-a-wave" d="M2 20 Q7 6 12 20 T22 20 T32 20 T42 20" fill="none" stroke="' + c('poor') + '" stroke-width="2" stroke-linecap="round"/>' +
		'<circle cx="20" cy="20" r="2.4" fill="' + c('poor') + '"/>' +
		'</svg>';
}

/* 状态圆点（静态，用于列表） */
function dot(grade, size) {
	var s = size || 10;
	var col = c(grade === 'excellent' || grade === 'good' ? 'ok' :
	            grade === 'fair' ? 'warn' :
	            grade === 'poor' ? 'poor' :
	            grade === 'severe' || grade === 'down' ? 'bad' : 'idle');
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 10 10" role="img" aria-label="status">' +
		'<circle cx="5" cy="5" r="4" fill="' + col + '"/>' +
		'</svg>';
}

/* 服务运行状态指示 */
function service(state, size) {
	var s = size || 34;
	if (state) {
		return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 34 34" role="img" aria-label="running">' +
			'<g class="nm-a-spin" style="transform-origin:17px 17px">' +
				'<circle cx="17" cy="17" r="12" fill="none" stroke="' + c('ok') + '" stroke-width="2.6" stroke-dasharray="16 10" stroke-linecap="round"/>' +
			'</g>' +
			'<path d="M11 17.5 L15.5 22 L23.5 12.5" fill="none" stroke="' + c('ok') + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
			'</svg>';
	}
	return '<svg class="nm-svg" width="' + s + '" height="' + s + '" viewBox="0 0 34 34" role="img" aria-label="stopped">' +
		'<circle cx="17" cy="17" r="12" fill="none" stroke="' + c('bad') + '" stroke-width="2.4" opacity="0.75"/>' +
		'<line x1="11" y1="11" x2="23" y2="23" stroke="' + c('bad') + '" stroke-width="2.6" stroke-linecap="round"/>' +
		'</svg>';
}

return Class.extend({
	__name__: 'NetMonitor.icons',

	colors: NM_COLORS,
	health: health,
	ping: ping,
	latency: latency,
	online: online,
	regionCN: regionCN,
	regionGlobal: regionGlobal,
	packetLoss: packetLoss,
	highLatency: highLatency,
	dot: dot,
	service: service
});
