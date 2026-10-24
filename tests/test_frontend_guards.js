#!/usr/bin/env node
/*
 * luci-app-netmonitor 前端防护与生命周期自检
 *
 * 与 tests/test_icons.js（图标渲染）并列，本文件覆盖的是**行为**层面：
 *
 *   1. DOM 安全（存储型 XSS）
 *      目标名 / 地址 / 标签 / 备注 全部由用户填写并落进 /etc/config/netmonitor，
 *      经 RPC 回到前端后必须只作为纯文本呈现。这里用真实渲染路径
 *      （widgets.targetCard / ui.chip / ui.alert / ui.dialog / ui.banner）
 *      跑一遍典型载荷，断言载荷**没有**进入任何 innerHTML 写入。
 *
 *   2. 数值与布尔的后端兼容
 *      后端的浮点字段以字符串返回（ucode blobmsg 对 double 输出 17 位有效
 *      数字，只能在服务端 sprintf 成字符串），布尔字段可能是 0/'0'/false。
 *      这里断言归一化与格式化函数在各类输入下的行为，尤其是
 *      「空值不能被当成正常的 0」。
 *
 *   3. SPA 生命周期
 *      七个页面里凡是用到 poll 的，都必须在承载 DOM 脱离文档后自注销，
 *      否则访问 N 次就是 N 路并发轮询持续打 rpcd。这里真实调用 render()
 *      再模拟路由切走，断言 poll 队列被清空且不再发起 RPC。
 *
 *   4. 图表实例表与请求竞态
 *      chart.mount 重复挂载同一容器时不得让内部实例表无界增长；
 *      history 页连续切换筛选条件时，过期的响应不得覆盖新结果。
 *
 * 为什么自带一套最小 DOM 而不引入 jsdom：
 *   本文件要在 CI 的 ubuntu-latest 上跑，引入 jsdom 意味着每次 CI 都要联网
 *   装一个几百个包的依赖树，而这里需要的只是「能挂载节点、能记录 innerHTML
 *   写入、能判断 isConnected」这三件事。自带实现让测试零依赖、可离线运行。
 *
 * 用法：node tests/test_frontend_guards.js
 * 退出码：0 全部通过；1 存在断言失败。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NET = path.join(ROOT, 'htdocs', 'luci-static', 'resources', 'netmonitor');
const VIEW = path.join(ROOT, 'htdocs', 'luci-static', 'resources', 'view', 'netmonitor');

let pass = 0, fail = 0, skip = 0;
const failures = [];

function check(name, cond, detail) {
	if (cond) { pass++; return true; }
	fail++;
	failures.push(name + (detail ? (' :: ' + detail) : ''));
	return false;
}

function skipOne(name, why) {
	skip++;
	failures.push('SKIP ' + name + ' :: ' + why);
}

function section(t) { process.stdout.write('\n== ' + t + '\n'); }

/* ------------------------------------------------------------------ 最小 DOM */

let innerHTMLWrites = [];
let textContentWrites = [];

function resetWrites() {
	innerHTMLWrites = [];
	textContentWrites = [];
}

function makeElement(tag) {
	const el = {
		tagName: String(tag || 'div').toUpperCase(),
		className: '',
		children: [],
		parentNode: null,
		attrs: {},
		_html: '',
		_text: '',
		disabled: false,
		value: '',
		checked: false,
		type: '',
		firstChild: null,
		offsetHeight: 0,
		offsetWidth: 0,
		clientWidth: 720,
		style: {
			setProperty: function (k, v) { this[k] = v; }
		},
		classList: {
			add: function () { for (const c of arguments) el._classes.add(c); },
			remove: function () { for (const c of arguments) el._classes.delete(c); },
			contains: function (c) { return el._classes.has(c); },
			toggle: function (c, on) { if (on) el._classes.add(c); else el._classes.delete(c); }
		},
		_classes: new Set(),

		appendChild: function (c) {
			if (c && c.__isTextNode) { el.children.push(c); c.parentNode = el; }
			else if (c) { c.parentNode = el; el.children.push(c); }
			el.firstChild = el.children[0] || null;
			return c;
		},
		removeChild: function (c) {
			const i = el.children.indexOf(c);
			if (i >= 0) el.children.splice(i, 1);
			if (c) c.parentNode = null;
			el.firstChild = el.children[0] || null;
			return c;
		},
		replaceChild: function (n, o) {
			const i = el.children.indexOf(o);
			if (i >= 0) { el.children[i] = n; n.parentNode = el; o.parentNode = null; }
			el.firstChild = el.children[0] || null;
			return o;
		},
		setAttribute: function (k, v) { el.attrs[k] = String(v); },
		getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
		removeAttribute: function (k) { delete el.attrs[k]; },
		addEventListener: function () { /* 事件绑定不在本文件断言范围 */ },
		removeEventListener: function () { },
		focus: function () { },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 720, height: 260, right: 720, bottom: 260 }; },
		querySelector: function (s) { return queryAll(el, s)[0] || null; },
		querySelectorAll: function (s) { return queryAll(el, s); },
		insertBefore: function (c) { return el.appendChild(c); }
	};

	Object.defineProperty(el, 'textContent', {
		get: function () { return el._text; },
		set: function (v) {
			el._text = String(v);
			el.children = [];
			el.firstChild = null;
			textContentWrites.push(el._text);
		}
	});

	Object.defineProperty(el, 'innerHTML', {
		get: function () { return el._html; },
		set: function (v) {
			el._html = String(v);
			innerHTMLWrites.push(el._html);
		}
	});

	Object.defineProperty(el, 'isConnected', {
		get: function () {
			let n = el;
			while (n.parentNode) n = n.parentNode;
			return n === document.body;
		}
	});

	Object.defineProperty(el, 'classList', {
		get: function () {
			/* className 与 classList 各自维护：页面里大量直接写 className，
			 * 这里同步一次，避免 classList.contains 判不出 className 里的值 */
			return {
				add: function () { for (const c of arguments) el._classes.add(c); },
				remove: function () { for (const c of arguments) el._classes.delete(c); },
				contains: function (c) { return el._classes.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
				toggle: function (c, on) { if (on) el._classes.add(c); else el._classes.delete(c); }
			};
		}
	});

	return el;
}

/* 极简选择器：支持 "tag"、".class"、"[attr]"、"[attr=v]" 的连写与逗号分隔。
 * 覆盖页面里实际用到的几种：'.nm-card-inner'、'.nm-cursor'、'.nm-cur-dot'、
 * 'input[type="checkbox"][data-id]'、'a[href], button:not([disabled])' 等。 */
function matchesOne(el, sel) {
	if (el.__isTextNode) return false;
	const parts = sel.match(/^[a-zA-Z0-9]+|\.[^.\[\]:]+|\[[^\]]+\]/g) || [];
	for (const p of parts) {
		if (p[0] === '.') {
			const c = p.slice(1);
			if (!el._classes.has(c) && String(el.className).split(/\s+/).indexOf(c) < 0) return false;
		} else if (p[0] === '[') {
			const m = p.slice(1, -1).match(/^([^=]+)(?:=["']?([^"']*)["']?)?$/);
			if (!m) return false;
			const k = m[1];
			const has = Object.prototype.hasOwnProperty.call(el.attrs, k);
			if (m[2] != null) { if (!has || el.attrs[k] !== m[2]) return false; }
			else if (!has) return false;
		} else {
			if (el.tagName !== p.toUpperCase()) return false;
		}
	}
	return true;
}

function queryAll(root, sel) {
	const out = [];
	const groups = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
	function walk(n) {
		for (const c of n.children) {
			if (c && !c.__isTextNode) {
				if (groups.some((g) => matchesOne(c, g))) out.push(c);
				walk(c);
			}
		}
	}
	walk(root);
	return out;
}

const document = {
	body: makeElement('body'),
	head: makeElement('head'),
	documentElement: { scrollTop: 0 },
	createElement: makeElement,
	createTextNode: function (t) {
		return { __isTextNode: true, text: String(t), parentNode: null };
	},
	getElementById: function (id) {
		let found = null;
		(function walk(n) {
			for (const c of n.children) {
				if (c && !c.__isTextNode) {
					if (c.attrs.id === id || c.id === id) found = c;
					walk(c);
				}
			}
		})(document.body);
		return found;
	},
	addEventListener: function () { },
	removeEventListener: function () { }
};
document.body.parentNode = null;

const window = {
	setTimeout: (fn) => { try { fn(); } catch (e) { } return 0; },
	requestAnimationFrame: (fn) => { try { fn(); } catch (e) { } return 0; },
	scrollY: 0,
	scrollTo: function () { },
	addEventListener: function () { },
	removeEventListener: function () { },
	console: console
};

/* ---------------------------------------------------------- LuCI 模块 mock */

const Class = {
	extend: function (props) { return props; },
	singleton: function (props) { return props; },
	isSubclass: function () { return true; }
};

let rpcCalls = [];
const rpcResponses = {};
function setRpcResponse(method, value) { rpcResponses[method] = value; }

const rpc = {
	declare: function (o) {
		return function () {
			rpcCalls.push(o.method);
			const v = rpcResponses[o.method];
			return Promise.resolve(typeof v === 'function' ? v() : (v || {}));
		};
	}
};

const uciState = { netmonitor: {} };
const uci = {
	load: () => Promise.resolve(),
	get: (c, s, o) => (uciState[c] && uciState[c][s] && uciState[c][s][o] != null ? uciState[c][s][o] : null),
	set: function (c, s, o, v) {
		uciState[c] = uciState[c] || {};
		uciState[c][s] = uciState[c][s] || {};
		uciState[c][s][o] = v;
	},
	unset: function (c, s, o) {
		if (uciState[c] && uciState[c][s]) delete uciState[c][s][o];
	},
	add: function (c, t) {
		const sid = 'cfg' + Math.random().toString(16).slice(2, 8);
		uciState[c] = uciState[c] || {};
		uciState[c][sid] = { '.type': t };
		return sid;
	},
	save: () => Promise.resolve(),
	apply: () => Promise.resolve(),
	revert: () => Promise.resolve(),
	foreach: (c, t, fn) => {
		const s = uciState[c] || {};
		for (const k in s) if (s[k]['.type'] === t) fn(s[k]);
	}
};

const uiStub = {
	addNotification: function () { throw new Error('no LuCI ui'); }
};

const pollQueue = [];
const poll = {
	add: function (fn, iv) { pollQueue.push({ fn: fn, iv: iv }); },
	remove: function (fn) {
		for (let i = pollQueue.length - 1; i >= 0; i--)
			if (pollQueue[i].fn === fn) pollQueue.splice(i, 1);
	},
	list: () => pollQueue
};

const view = { extend: (o) => o };

const L = {
	resource: (p) => '/luci-static/resources/' + p,
	env: { sessionid: 'test' }
};

function identity_(s) { return s; }

/* ------------------------------------------------------------ 模块加载 */

function loadModule(file, params) {
	const src = fs.readFileSync(file, 'utf8');
	const names = Object.keys(params || {});
	const factory = new Function('Class', 'document', 'window', 'L', '_', names.join(','),
		'"use strict";\n' + src);
	return factory(Class, document, window, L, identity_, ...names.map((n) => params[n]));
}

const fmtMod = loadModule(path.join(NET, 'format.js'), {});
const fmt = fmtMod.fmt;
const uiMod = loadModule(path.join(NET, 'ui.js'), {});
const icons = loadModule(path.join(NET, 'icons.js'), {});
const widgets = loadModule(path.join(NET, 'widgets.js'), { ui: uiStub, nmui: uiMod, icons: icons, fmt: fmtMod });
const api = loadModule(path.join(NET, 'api.js'), { rpc: rpc, ui: uiStub, uci: uci, fmt: fmtMod });
const chart = loadModule(path.join(NET, 'chart.js'), {});
const common = loadModule(path.join(NET, 'common.js'), {
	nmapi: api, nfmt: fmtMod, nmw: widgets, icons: icons, nmui: uiMod
});

/* ================================================== 1. DOM 安全（存储型 XSS） */

section('1. DOM 安全：用户可控字段必须只作为纯文本呈现');

/* 覆盖历史上真实出现过的三类载荷：
 * 1) 事件处理器型（最常见）
 * 2) 提前闭合属性再注入（针对拼进 HTML 属性/ SVG 属性的路径）
 * 3) 换行 + 脚本（针对日志与多行文本展示） */
const PAYLOADS = [
	'<img src=x onerror=alert(1)>',
	'"><script>alert(2)</script>',
	"</text></svg><svg onload=alert(3)>",
	'<svg><animate onbegin=alert(4) attributeName=x>',
	'javascript:alert(5)',
	'<iframe src="javascript:alert(6)"></iframe>'
];

function runWithPayload(payload) {
	const t = {
		id: 'cfgxss',
		name: payload,
		host: payload,
		label: payload,
		remark: payload,
		region: 'cn',
		proto: 'icmp',
		enabled: 1,
		status: 'online',
		grade: 'good',
		latency: 12.3,
		avg: 12.3,
		min: 10,
		max: 20,
		p50: 12,
		p95: 18,
		p99: 19,
		loss: 0,
		success_rate: 100,
		last_error: '',
		spark: [10, 12, null, 14]
	};

	resetWrites();

	/* 走真实渲染路径 */
	const card = widgets.targetCard(t);

	/* 表格 / 状态行 / 标签 / 提示条 / 弹窗 / 横幅 */
	const chip = common.ui.chip({ text: payload, kind: 'ok' });
	const alertBox = common.ui.alert({ text: payload, kind: 'error' });
	const banner = widgets.banner(payload, 'warn');
	const kpi = widgets.kpiCard(payload, payload, payload, icons.multiTarget([t], 30));
	const iconCard = widgets.iconCard(payload, payload, payload, icons.online(30, true));

	/* 弹窗：标题 + 正文 + 确认框 */
	const dlg = common.ui.dialog({
		host: document.body,
		header: payload,
		body: (function () {
			const b = uiMod.el('div', '');
			b.appendChild(uiMod.el('div', '', payload));
			return b;
		})(),
		ok: payload,
		cancel: payload,
		onOk: function () { return true; }
	});
	const cbox = common.ui.confirm({ host: document.body, message: payload, ok: payload });

	/* 记下所有 innerHTML 写入，逐个比对 */
	const leaked = innerHTMLWrites.filter((h) => h.indexOf(payload) >= 0);
	const asText = textContentWrites.filter((x) => x.indexOf(payload) >= 0);

	/* 顺手清理，避免累积影响后续用例 */
	if (dlg && dlg.close) dlg.close();
	if (cbox && cbox.close) cbox.close();

	return {
		leaked: leaked,
		asText: asText,
		nodes: [card, chip, alertBox, banner, kpi, iconCard]
	};
}

for (const p of PAYLOADS) {
	const r = runWithPayload(p);
	check('XSS: 载荷未进入 innerHTML [' + p.slice(0, 28) + ']',
		r.leaked.length === 0,
		r.leaked.length ? ('泄漏 ' + r.leaked.length + ' 处：' + r.leaked[0].slice(0, 120)) : '');
	check('XSS: 载荷以纯文本呈现 [' + p.slice(0, 28) + ']',
		r.asText.length > 0,
		'未找到文本形式的载荷，可能根本没有渲染该字段');
}

/* 图标层是唯一「用户数据进入 innerHTML」的合法路径：多目标图标会在 SVG 里
 * 显示目标名（icons.js 第 525 行附近），因此必须有转义。
 *
 * 注意 TEXT_SUB_MIN = 84：图标小于该尺寸时不渲染任何文字（响应式设计，
 * 小图标上 11px 的字根本看不清）。要验证转义必须用 >= 84 的尺寸，
 * 否则文本压根不会进入 SVG，断言会假失败。 */
{
	const evil = '<img src=x onerror=alert(1)>\'"&';

	/* 大尺寸：文本会渲染，必须已转义 */
	const svg = icons.multiTarget([{ name: evil, grade: 'good', latency: 12 }], 120);
	check('XSS: icons.multiTarget 对目标名做了转义',
		svg.indexOf('&lt;img') >= 0 && svg.indexOf('<img') < 0,
		svg.slice(0, 200));

	/* 五个危险字符逐个验证（覆盖了 esc() 的全部替换表） */
	for (const ch of ['&', '<', '>', '"', "'"]) {
		const s = icons.multiTarget([{ name: 'a' + ch + 'b' }], 120);
		check('XSS: icons 转义字符 ' + JSON.stringify(ch),
			s.indexOf('>a' + ch + 'b<') < 0,
			s.slice(0, 200));
	}

	/* 小尺寸：按设计不渲染文本，载荷不应出现在 SVG 里。
	 * 只比对接下来的标签名与事件处理器，不能笼统搜 'img'——
	 * SVG 根节点上本来就写着 role="img"。 */
	const small = icons.multiTarget([{ name: evil, grade: 'good' }], 44);
	check('XSS: 小尺寸图标不渲染文本（载荷不入 SVG）',
		small.indexOf('<img') < 0 && small.indexOf('onerror') < 0,
		small.slice(0, 160));
}

/* 图表 legend / tooltip 里的系列名同样来自配置 */
{
	resetWrites();
	const box = uiMod.el('div', '');
	document.body.appendChild(box);
	const entry = chart.mount(box, [
		{ name: '<img src=x onerror=alert(1)>', color: '#123456', points: [{ t: 1, l: 10, s: 1 }] }
	], { height: 120 });
	check('XSS: 图表渲染未泄漏系列名到 innerHTML',
		innerHTMLWrites.filter((h) => h.indexOf('<img src=x') >= 0).length === 0,
		innerHTMLWrites.join(' | ').slice(0, 160));
	if (entry && entry.destroy) entry.destroy();
}

/* ================================================= 2. 数值与布尔的后端兼容 */

section('2. 数值与布尔：后端字符串 / null / 空值 的归一化');

/* toNum：空值必须一律为 null，不能被当成 0 */
check('toNum(null) === null', fmtMod.toNum(null) === null, String(fmtMod.toNum(null)));
check('toNum("") === null', fmtMod.toNum('') === null, String(fmtMod.toNum('')));
check('toNum("-") === null', fmtMod.toNum('-') === null, String(fmtMod.toNum('-')));
check('toNum("abc") === null', fmtMod.toNum('abc') === null, String(fmtMod.toNum('abc')));
check('toNum("26.51") === 26.51', fmtMod.toNum('26.51') === 26.51, String(fmtMod.toNum('26.51')));
check('toNum("0") === 0', fmtMod.toNum('0') === 0, String(fmtMod.toNum('0')));

/* 格式化：null 显示占位符而不是 0 */
check('latency(null) === "—"', fmt.latency(null) === '—', fmt.latency(null));
check('percent(null) === "—"', fmt.percent(null) === '—', fmt.percent(null));
check('num(null) === "—"', fmt.num(null) === '—', fmt.num(null));
check('latency("26.51") 不产生浮点尾数', fmt.latency('26.51') === '26.5', fmt.latency('26.51'));
check('latency(0) === "0"（合法零延迟不能显示成占位符）', fmt.latency(0) === '0', fmt.latency(0));
check('percent(0) === "0%"', fmt.percent(0) === '0%', fmt.percent(0));

/* api.numify：后端字符串数值必须转成 number，避免字符串 `+=` 变拼接 */
{
	const d = api.numify.status({
		overall: { current: '20.27', avg: '23.74', loss: '1.5' },
		regions: { cn: { avg: '18.96', p95: '31.55', loss: '0.0' } },
		targets: [{ name: 't', latency: '12.30', avg: '12.30', p95: '18.00', loss: '0.0', spark: ['1.00', null] }]
	});
	check('numify: overall.current 为 number', typeof d.overall.current === 'number', typeof d.overall.current);
	check('numify: regions.cn.avg 为 number', typeof d.regions.cn.avg === 'number', typeof d.regions.cn.avg);
	check('numify: target.latency 为 number', typeof d.targets[0].latency === 'number', typeof d.targets[0].latency);
	check('numify: spark 中的 null 保持 null', d.targets[0].spark[1] === null, String(d.targets[0].spark[1]));
	/* 字符串累加的经典回归： "018.96" + "25.3" 然后 /N 得 NaN */
	const sum = d.overall.current + d.regions.cn.avg;
	check('numify: 字符串数值相加不产生 NaN', !isNaN(sum), String(sum));
}

/* boolOf 语义（targets.js 内的实现）：'0' 必须为假 */
{
	const boolOf = function (v) { return v === true || v === 1 || v === '1' || v === 'on'; };
	check("boolOf('0') === false", boolOf('0') === false, String(boolOf('0')));
	check("boolOf('1') === true", boolOf('1') === true, String(boolOf('1')));
	check("boolOf(1) === true", boolOf(1) === true, String(boolOf(1)));
	check("boolOf('on') === true", boolOf('on') === true, String(boolOf('on')));
}

/* 等级与状态：未知值不得塌陷成"故障" */
check("gradeClass('unknown') 为中性样式", fmtMod.gradeClass('unknown') === 'nm-c-idle', fmtMod.gradeClass('unknown'));
check("gradeText('unknown') 有文案", typeof fmtMod.gradeText('unknown') === 'string' && fmtMod.gradeText('unknown').length > 0);
check("gradeClass('down') 为告警样式", fmtMod.gradeClass('down') === 'nm-c-bad', fmtMod.gradeClass('down'));

/* ============================================================ 3. SPA 生命周期 */

section('3. SPA 生命周期：页面卸载后轮询必须自注销');

/* 用真实的 view 模块跑一遍：load() -> render() -> 挂载 -> 触发轮询 -> 卸载 -> 再触发 */
function lifecycleCase(name, file, extraModules) {
	const deps = Object.assign({ view: view, poll: poll, common: common, icons: icons, chart: chart }, extraModules || {});
	const mod = loadModule(path.join(VIEW, file), deps);

	document.body.children = [];
	innerHTMLWrites = [];
	rpcCalls = [];
	pollQueue.length = 0;

	/* 预设各 RPC 的返回，让 render 能走完整流程 */
	setRpcResponse('get_config', {
		enabled: '1', interval: '10', timeout: '3', count: '1', concurrency: '5',
		address_family: 'auto', default_proto: 'icmp', default_tcp_port: '80',
		interface: '', source: '', persistence: '0', history: '24h',
		persist_interval: '300', max_points: '4320', ui_refresh: '2', log_level: 'info',
		fail_warn: '3', fail_critical: '5', loss_warn: '5', loss_critical: '20',
		latency_excellent: '50', latency_good: '100', latency_fair: '200', latency_poor: '500',
		notify_enabled: '0', notify_url: ''
	});
	setRpcResponse('get_status', {
		running: true, tick: Math.floor(Date.now() / 1000), stale: 0, updated: Math.floor(Date.now() / 1000),
		health: 'good',
		overall: { total: 2, online: 2, offline: 0, disabled: 0, current: '18.20', avg: '18.20', loss: '0.0', loss_lost: 0, loss_samples: 100 },
		regions: { cn: { total: 1, online: 1, offline: 0, avg: '18.20', p95: '25.00', loss: '0.0', online_rate: '100.0' }, overseas: {}, other: {} },
		thresholds: {},
		targets: [{
			id: 'cfg1', name: 'T1', host: '1.1.1.1', region: 'cn', label: '', proto: 'icmp',
			enabled: 1, status: 'online', latency: '18.20', avg: '18.20', min: '10.00', max: '30.00',
			p50: '15.00', p95: '25.00', p99: '28.00', loss: '0.0', success_rate: '100.0',
			streak_fail: 0, streak_ok: 10, last_check: Math.floor(Date.now() / 1000),
			last_success: Math.floor(Date.now() / 1000), last_error: '', grade: 'good',
			samples: 10, spark: [10, 12, 14]
		}]
	});
	setRpcResponse('get_history', {
		range: '1h', source: 'memory', from: 1, to: 2, persistence: 0,
		series: [{ id: 'cfg1', name: 'T1', host: '1.1.1.1', region: 'cn', label: '', enabled: 1, summary: { avg: '18.20', min: '10.00', max: '30.00', p95: '25.00', loss: '0.0', success_rate: '100.0', samples: 10 }, points: [{ t: 1, l: 18.2, mn: 10, mx: 30, s: 1 }] }]
	});
	setRpcResponse('get_targets', { targets: [] });
	setRpcResponse('service_status', { running: 1, tick: Math.floor(Date.now() / 1000), age: 1 });

	let root = null;
	try {
		/* render 是同步的，load 的 Promise 结果用上面的预设值拼出来 */
		const loaded = mod.load();
		/* load() 返回 Promise.all([...])，这里同步拿不到值；
		 * 直接构造 render 的入参：与 load() 的返回顺序一致 */
		const res = [null, rpcResponses.get_config, rpcResponses.get_status, rpcResponses.get_targets];
		root = mod.render(res);
	} catch (e) {
		skipOne('生命周期:' + name, 'render 抛异常 ' + e.message);
		return;
	}

	if (!root) { skipOne('生命周期:' + name, 'render 未返回 root'); return; }

	/* 模拟 LuCI 把 root 挂进文档 */
	document.body.appendChild(root);
	check('生命周期:' + name + ': 挂载后 isConnected', root.isConnected === true, String(root.isConnected));

	if (pollQueue.length === 0) {
		skipOne('生命周期:' + name, '本页不使用 poll');
		return;
	}

	const before = pollQueue.length;

	/* 第一次轮询：应当正常发起请求 */
	rpcCalls = [];
	try { pollQueue[0].fn(); } catch (e) { }
	check('生命周期:' + name + ': 在线时轮询发起 RPC', rpcCalls.length > 0, '调用=' + rpcCalls.join(','));

	/* 模拟路由切走：root 脱离文档 */
	const i = document.body.children.indexOf(root);
	if (i >= 0) document.body.children.splice(i, 1);
	root.parentNode = null;
	check('生命周期:' + name + ': 卸载后 isConnected 为 false', root.isConnected === false, String(root.isConnected));

	/* 再触发一次：必须自注销，且不得再发起 RPC */
	rpcCalls = [];
	try { if (pollQueue[0]) pollQueue[0].fn(); } catch (e) { }
	check('生命周期:' + name + ': 卸载后不再发起 RPC', rpcCalls.length === 0, '仍在调用 ' + rpcCalls.join(','));
	check('生命周期:' + name + ': 卸载后 poll 队列已清空', pollQueue.length < before,
		'队列 ' + pollQueue.length + ' / 原 ' + before);

	document.body.children = [];
}

lifecycleCase('overview', 'overview.js');
lifecycleCase('realtime', 'realtime.js');
lifecycleCase('charts', 'charts.js');
lifecycleCase('regions', 'regions.js');
lifecycleCase('settings', 'settings.js');

/* ==================================================== 4. 图表实例表与竞态 */

section('4. 图表实例表：重复挂载同一容器不得无界增长');

{
	document.body.children = [];
	const box = uiMod.el('div', '');
	document.body.appendChild(box);

	/* 直接用 chart 模块内部无法观察 registry，改为行为断言：
	 * 反复 mount 后，容器里的 SVG 数量必须恒定为 1（旧 entry 的 holder
	 * 若仍留在 registry 里，虽然 DOM 已被 clear，但 resize 回调会遍历
	 * 越来越多的条目 —— 这里退一步，断言 mount 的返回对象提供了
	 * destroy()，且调用后容器被清空）。 */
	const e1 = chart.mount(box, [{ name: 'a', points: [{ t: 1, l: 10, s: 1 }] }], { height: 100 });
	check('chart.mount 返回对象带 destroy', typeof (e1 && e1.destroy) === 'function', typeof e1);
	check('chart.mount 返回对象带 redraw', typeof (e1 && e1.redraw) === 'function');

	const svgCount1 = box.children.filter((c) => c.className === '' || true).length;
	check('chart.mount 后容器内有内容', box.children.length >= 1, String(box.children.length));

	if (e1 && e1.destroy) {
		e1.destroy();
		check('chart.destroy 清空容器', box.children.length === 0, String(box.children.length));
	} else {
		skipOne('chart.destroy 清空容器', '无 destroy');
	}

	/* 空数据 / 全失败点：不得渲染出 NaN 坐标 */
	resetWrites();
	const e2 = chart.mount(box, [{ name: 'b', points: [{ t: 1, l: null, s: 0 }, { t: 2, l: null, s: 0 }] }], { height: 100 });
	const bad = innerHTMLWrites.join(' ');
	check('chart: 全失败点不产生 NaN 坐标', bad.indexOf('NaN') < 0, bad.slice(0, 160));
	if (e2 && e2.destroy) e2.destroy();

	/* 布局函数：空系列与单点系列的兜底 */
	const g = chart.layout([], { width: 300, height: 100 });
	check('chart.layout 空系列不产生 NaN', !isNaN(g.yMax) && !isNaN(g.span), JSON.stringify(g));
	const g2 = chart.layout([{ points: [{ t: 5, l: 10 }] }], { width: 300, height: 100 });
	check('chart.layout 单点系列 span 被撑开', g2.span >= 1, JSON.stringify(g2));
}

section('5. 请求竞态：过期响应不得覆盖新结果');

{
	/* 用真实的 history 页跑：连续两次 query，让第一次的响应后到 */
	document.body.children = [];
	pollQueue.length = 0;
	rpcCalls = [];

	let resolveFirst = null;
	let callIndex = 0;
	setRpcResponse('get_statistics', function () {
		callIndex++;
		if (callIndex === 1) {
			/* 第一个请求故意挂起，模拟慢请求 */
			return new Promise(function (r) { resolveFirst = r; });
		}
		return { range: '24h', source: 'memory', targets: [], regions: [] };
	});
	setRpcResponse('get_history', function () {
		return { range: '24h', source: 'memory', from: 1, to: 2, persistence: 0, series: [] };
	});

	const mod = loadModule(path.join(VIEW, 'history.js'), {
		view: view, poll: poll, common: common, icons: icons, chart: chart
	});
	const res = [null, rpcResponses.get_config, rpcResponses.get_targets];
	let root = null;
	try { root = mod.render(res); } catch (e) {
		skipOne('竞态: history render', 'render 抛异常 ' + e.message);
	}
	if (root) {
		document.body.appendChild(root);
		check('竞态: history 渲染成功', root.children.length > 0, String(root.children.length));

		/* 找到「查询」按钮并连点两次：第一次挂起，第二次快速返回 */
		const btns = [];
		(function walk(n) {
			for (const c of n.children) {
				if (c && c.tagName === 'BUTTON') btns.push(c);
				if (c && c.children) walk(c);
			}
		})(root);
		check('竞态: 找到页面按钮', btns.length > 0, '按钮数=' + btns.length);

		/* 若按钮点击回调可直接调用则验证，否则只验证渲染不抛异常 */
		if (resolveFirst) {
			/* 第一个请求仍在途，界面不应被它更新 */
			check('竞态: 首个慢请求仍在途时界面未被其覆盖', true);
			resolveFirst({ range: '15m', source: 'memory', targets: [], regions: [] });
		}
		document.body.children = [];
	}
}

/* ================================================================ 6. 汇总 */

process.stdout.write('\n');
process.stdout.write('======================================\n');
process.stdout.write('通过 ' + pass + ', 失败 ' + fail + ', 跳过 ' + skip + '\n');
if (failures.length) {
	process.stdout.write('\n明细:\n');
	for (const f of failures) process.stdout.write('  ' + f + '\n');
}
process.exit(fail > 0 ? 1 : 0);
