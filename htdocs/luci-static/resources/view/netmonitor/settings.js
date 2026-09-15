/*
 * 设置页面：全局参数（UCI form）、后台服务控制、历史数据维护
 */

'use strict';
'require view';
'require form';
'require uci';
'require poll';
'require netmonitor.common as common';
'require netmonitor.icons as icons';

return view.extend({
	load: function() {
		common.css();
		return Promise.all([
			common.loadI18n(),
			uci.load('netmonitor')
		]);
	},

	render: function() {
		common.css();

		var m, s, o;
		var root = common.el('div', 'nm-root');
		var page = common.el('div', 'nm-page');
		root.appendChild(page);

		/* ---------------------------------------------------- 服务控制 */
		var svc = common.el('div', 'nm-card');
		var svcRow = common.el('div', 'nm-row');
		var svcIcon = common.el('div', '');
		svcRow.appendChild(svcIcon);
		var svcText = common.el('div', 'nm-card-sub', _('Checking...'));
		svcRow.appendChild(svcText);
		svcRow.appendChild(common.el('div', 'nm-spacer'));

		function svcBtn(label, fn, cls) {
			var b = common.el('button', 'nm-btn ' + (cls || ''), label);
			b.addEventListener('click', function() {
				b.disabled = true;
				fn().then(function() {
					common.notify(_('Operation completed'));
					refreshSvc();
				}).catch(function(e) {
					common.notify(String(e.message || e), 'error');
				}).then(function() { b.disabled = false; });
			});
			return b;
		}

		svcRow.appendChild(svcBtn(_('Start'), common.api.startService, 'nm-btn-primary'));
		svcRow.appendChild(svcBtn(_('Stop'), common.api.stopService));
		svcRow.appendChild(svcBtn(_('Restart'), common.api.restartService));
		svc.appendChild(svcRow);

		var clearRow = common.el('div', 'nm-row');
		clearRow.style.marginTop = '12px';
		clearRow.appendChild(common.el('div', 'nm-card-sub', _('Clear all collected samples and persistent history')));
		clearRow.appendChild(common.el('div', 'nm-spacer'));
		var btnClear = common.el('button', 'nm-btn nm-btn-danger', _('Clear history'));
		btnClear.addEventListener('click', function() {
			if (!window.confirm(_('Clear all collected history data?'))) return;
			btnClear.disabled = true;
			common.api.clearHistory(null).then(function() {
				common.notify(_('History cleared'));
			}).catch(function(e) {
				common.notify(String(e.message || e), 'error');
			}).then(function() { btnClear.disabled = false; });
		});
		clearRow.appendChild(btnClear);
		svc.appendChild(clearRow);
		page.appendChild(svc);

		/* 当前生效配置：数值直接取自 UCI，图标与数值一一对应。
		 * 探测间隔→ping、超时/并发→齿轮、持久化→数据库、地址族→双栈、
		 * 通知→铃铛、界面刷新→时钟。 */
		function ucfg(key, dflt) {
			var v = null;
			try { v = uci.get('netmonitor', 'global', key); } catch (e) { v = null; }
			return (v == null || v === '') ? dflt : v;
		}

		var strip = common.el('div', 'nm-grid');
		page.appendChild(strip);

		function renderStrip() {
			common.clear(strip);
			var interval = String(ucfg('interval', '10'));
			var timeout = String(ucfg('timeout', '3'));
			var count = String(ucfg('count', '1'));
			var conc = String(ucfg('concurrency', '5'));
			var persist = String(ucfg('persistence', '0'));
			var hist = String(ucfg('history', '24h'));
			var fam = String(ucfg('address_family', 'auto'));
			var notify = String(ucfg('notify_enabled', '0'));
			var enabled = String(ucfg('enabled', '1'));
			var v6 = (fam === 'ipv6' || fam === 'both' || fam === 'auto');

			strip.appendChild(common.iconCard(_('Check interval'), interval + ' s',
				_('Packets per probe') + ': ' + count,
				icons.ping(58, { grade: 'good' }), 'nm-c-ok'));

			strip.appendChild(common.iconCard(_('Probe timeout'), timeout + ' s',
				_('Concurrent probes') + ': ' + conc, icons.gear(58)));

			strip.appendChild(common.iconCard(_('Persistent history'),
				(persist === '1') ? _('Enabled') : _('Disabled'),
				_('Retention') + ': ' + hist, icons.database(58),
				(persist === '1') ? 'nm-c-warn' : 'nm-c-ok'));

			strip.appendChild(common.iconCard(_('Address family'), fam,
				_('Master switch') + ': ' + ((enabled === '1') ? _('Enabled') : _('Disabled')),
				icons.dualStack(fam, fam !== 'ipv6', v6, 58)));

			strip.appendChild(common.iconCard(_('Enable notification'),
				(notify === '1') ? _('Enabled') : _('Disabled'),
				_('Reserved') + ' · ' + _('Thresholds'), icons.bell(0, 58)));

			strip.appendChild(common.iconCard(_('UI refresh interval'),
				String(ucfg('ui_refresh', '2')) + ' s', _('Independent from the probe interval'),
				icons.clock(null, 58)));
		}
		renderStrip();

		function refreshSvc() {
			return common.api.serviceStatus().then(function(d) {
				common.clear(svcIcon);
				svcIcon.appendChild(common.svgBox(icons.service(!!d.running, 30), ''));
				svcText.textContent = (d.running ? _('Service running') : _('Service stopped')) +
					' · ' + _('Last update') + ': ' + (d.tick ? common.fmt.ago(d.tick) : _('Never'));
			}).catch(function(e) {
				svcText.textContent = String(e.message || e);
			});
		}
		refreshSvc();
		poll.add(refreshSvc, 10);

		/* ---------------------------------------------------- 全局设置表单 */
		m = new form.JSONMap({}, 'netmonitor', _('Global settings'));
		m.submit = false;
		m.reset = false;

		s = m.section(form.NamedSection, 'global', 'netmonitor', _('Detection'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable monitoring'),
			_('Master switch. When disabled the background daemon stops probing.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'interval', _('Check interval (seconds)'),
			_('Recommended values: 1, 5, 10, 15, 30, 60, 120, 300. Allowed range 1-3600.'));
		o.datatype = 'range(1,3600)';
		o.default = '10';
		o.rmempty = false;

		o = s.option(form.Value, 'timeout', _('Probe timeout (seconds)'),
			_('Per-packet wait time before a probe is considered lost.'));
		o.datatype = 'range(1,30)';
		o.default = '3';

		o = s.option(form.Value, 'count', _('Packets per probe'),
			_('Higher values give better loss statistics but cost more time.'));
		o.datatype = 'range(1,20)';
		o.default = '1';

		o = s.option(form.Value, 'concurrency', _('Concurrent probes'),
			_('Maximum number of targets probed in parallel.'));
		o.datatype = 'range(1,50)';
		o.default = '5';

		o = s.option(form.ListValue, 'address_family', _('Address family'));
		o.value('auto', _('Auto'));
		o.value('ipv4', _('IPv4 only'));
		o.value('ipv6', _('IPv6 only'));
		o.default = 'auto';

		o = s.option(form.Value, 'interface', _('Outbound interface (optional)'),
			_('Example: wan, wwan. Leave empty to use the system default route.'));
		o.placeholder = _('auto');
		o.rmempty = true;

		o = s.option(form.Value, 'source', _('Source address (optional)'),
			_('Bind probes to a specific source IP address.'));
		o.rmempty = true;

		s = m.section(form.NamedSection, 'global', 'netmonitor', _('Data retention'));

		o = s.option(form.Flag, 'persistence', _('Persistent history'),
			_('Write aggregated samples to flash periodically. Disabled by default to protect flash lifetime.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.ListValue, 'history', _('History retention'));
		o.value('1h', _('1 hour'));
		o.value('6h', _('6 hours'));
		o.value('12h', _('12 hours'));
		o.value('24h', _('24 hours'));
		o.value('3d', _('3 days'));
		o.value('7d', _('7 days'));
		o.value('30d', _('30 days'));
		o.default = '24h';
		o.depends('persistence', '1');

		o = s.option(form.Value, 'persist_interval', _('Flush interval (seconds)'),
			_('How often aggregated data is written to flash. Larger values mean fewer writes.'));
		o.datatype = 'range(60,3600)';
		o.default = '300';
		o.depends('persistence', '1');

		o = s.option(form.Value, 'max_points', _('In-memory samples per target'),
			_('Ring buffer size in /tmp. 4320 samples at 10s interval covers about 12 hours.'));
		o.datatype = 'range(60,200000)';
		o.default = '4320';

		s = m.section(form.NamedSection, 'global', 'netmonitor', _('Thresholds'));

		o = s.option(form.Value, 'latency_excellent', _('Excellent below (ms)'));
		o.datatype = 'range(1,10000)';
		o.default = '50';
		o = s.option(form.Value, 'latency_good', _('Good below (ms)'));
		o.datatype = 'range(1,10000)';
		o.default = '100';
		o = s.option(form.Value, 'latency_fair', _('Fair below (ms)'));
		o.datatype = 'range(1,10000)';
		o.default = '200';
		o = s.option(form.Value, 'latency_poor', _('Poor below (ms)'));
		o.datatype = 'range(1,10000)';
		o.default = '500';

		o = s.option(form.Value, 'loss_warn', _('Loss warning (%)'));
		o.datatype = 'range(0,100)';
		o.default = '5';
		o = s.option(form.Value, 'loss_critical', _('Loss critical (%)'));
		o.datatype = 'range(0,100)';
		o.default = '20';
		o = s.option(form.Value, 'fail_warn', _('Consecutive failures to warn'));
		o.datatype = 'range(1,100)';
		o.default = '3';
		o = s.option(form.Value, 'fail_critical', _('Consecutive failures to critical'));
		o.datatype = 'range(1,1000)';
		o.default = '5';

		s = m.section(form.NamedSection, 'global', 'netmonitor', _('Interface & logging'));

		o = s.option(form.Value, 'ui_refresh', _('UI refresh interval (seconds)'),
			_('How often the page fetches new state. Independent from the probe interval.'));
		o.datatype = 'range(1,60)';
		o.default = '2';

		o = s.option(form.ListValue, 'log_level', _('Log level'),
			_('Normal probes are never logged. Only state changes and failures produce log entries.'));
		o.value('debug', _('Debug'));
		o.value('info', _('Info'));
		o.value('warning', _('Warning'));
		o.value('error', _('Error'));
		o.default = 'info';

		s = m.section(form.NamedSection, 'global', 'netmonitor', _('Notification (reserved)'));

		o = s.option(form.Flag, 'notify_enabled', _('Enable notification'),
			_('Interface is reserved for future webhook / Telegram / WeCom / DingTalk / mail support.'));
		o.default = '0';

		o = s.option(form.Value, 'notify_url', _('Notification endpoint'),
			_('Reserved. Leave empty until a notification backend is available.'));
		o.depends('notify_enabled', '1');

		/* LuCI 的 form.JSONMap.render() 返回 Promise 而非 DOM 节点，
		 * 直接 appendChild(Promise) 会抛
		 * "Node.appendChild: Argument 1 does not implement interface Node"，
		 * 必须等 Promise resolve 后再挂载。 */
		return m.render().then(function(formNode) {
			if (formNode) page.appendChild(formNode);
			return root;
		});
	}
});
