/*
 * 总览页面：总体健康状态、关键指标、目标卡片
 * 采用局部刷新（LuCI poll），不会整页重载，也不会触发额外的 Ping。
 */

'use strict';
'require view';
'require poll';
'require netmonitor.common as common';
'require netmonitor.icons as icons';

return view.extend({
	load: function() {
		common.css();
		return Promise.all([
			common.loadI18n(),
			common.api.getConfig(),
			common.api.getStatus(true)
		]);
	},

	render: function(res) {
		common.css();

		var cfg = (res && res[1]) || {};
		var first = (res && res[2]) || null;
		var refresh = Math.max(1, parseInt(cfg.ui_refresh, 10) || 2);

		var root = common.el('div', 'nm-root');
		var page = common.el('div', 'nm-page');
		root.appendChild(page);

		var hero = common.el('div', 'nm-hero');
		var bannerBox = common.el('div', '');
		var kpi = common.el('div', 'nm-grid');
		var cards = common.el('div', 'nm-grid-wide');
		var foot = common.el('div', 'nm-card');

		page.appendChild(hero);
		page.appendChild(bannerBox);
		page.appendChild(kpi);
		page.appendChild(cards);
		page.appendChild(foot);

		function renderHero(d) {
			common.clear(hero);

			var state = 'unknown';
			if (d.health === 'good') state = 'good';
			else if (d.health === 'warning') state = 'warning';
			else if (d.health === 'critical') state = 'critical';

			hero.style.setProperty('--nm-hero-glow',
				state === 'good' ? 'rgba(46,158,91,0.12)' :
				(state === 'unknown' ? 'transparent' : 'rgba(207,68,55,0.12)'));

			hero.appendChild(common.svgBox(icons.health(state, 72), 'nm-hero-icon'));

			var main = common.el('div', 'nm-hero-main');
			var title = _('No monitoring data');
			var desc = _('Add and enable monitoring targets to start collecting data.');

			if (state === 'good') {
				title = _('Network is healthy');
				desc = _('All monitored targets respond normally.');
			} else if (state === 'warning') {
				title = _('Network problems detected');
				desc = _('Some targets are unreachable or unstable.');
			} else if (state === 'critical') {
				title = _('Serious network failure');
				desc = _('One or more targets failed consecutively beyond the threshold.');
			}

			main.appendChild(common.el('h3', 'nm-hero-title', title));
			main.appendChild(common.el('div', 'nm-hero-desc', desc));

			var o = d.overall || {};
			var stats = common.el('div', 'nm-hero-stats');
			function stat(v, label) {
				var s = common.el('div', 'nm-hero-stat');
				s.appendChild(common.el('b', '', v));
				s.appendChild(common.el('span', '', label));
				return s;
			}
			stats.appendChild(stat(common.fmt.latency(o.current) + ' ms', _('Current latency')));
			stats.appendChild(stat(common.fmt.percent(o.loss), _('Packet loss')));
			stats.appendChild(stat(String(o.online || 0), _('Online')));
			stats.appendChild(stat(String(o.offline || 0), _('Abnormal')));
			stats.appendChild(stat(String(o.total || 0), _('Target count')));
			main.appendChild(stats);

			hero.appendChild(main);
		}

		function renderBanners(d) {
			common.clear(bannerBox);
			if (!d.running) {
				bannerBox.appendChild(common.banner(
					_('Background service is not running. Monitoring is stopped.'), 'warn'));
			} else if (d.stale) {
				bannerBox.appendChild(common.banner(
					_('Background service did not update data recently. Check the service status.'), 'warn'));
			}
			if (d.overall && d.overall.total === 0) {
				bannerBox.appendChild(common.banner(
					_('No enabled targets. Go to Targets to add one.'), 'info'));
			}
		}

		function renderKpi(d) {
			common.clear(kpi);
			var o = d.overall || {};
			var r = d.regions || {};
			var cn = r.cn || {};
			var ov = r.overseas || {};

			function regionCard(title, x) {
				var c = common.el('div', 'nm-card');
				var head = common.el('div', 'nm-row');
				head.appendChild(common.el('span', 'nm-card-title', title));
				c.appendChild(head);
				var v = common.el('div', 'nm-card-value ' + ((x.abnormal > 0) ? 'nm-c-warn' : 'nm-c-ok'),
					(x.online || 0) + ' / ' + (x.total || 0));
				c.appendChild(v);
				c.appendChild(common.el('div', 'nm-card-sub',
					_('Avg') + ' ' + common.fmt.latency(x.avg) + ' ms · ' +
					_('P95') + ' ' + common.fmt.latency(x.p95) + ' ms · ' +
					_('Loss') + ' ' + common.fmt.percent(x.loss)));
				return c;
			}

			kpi.appendChild(common.kpiCard(_('Average latency'), common.fmt.latency(o.avg) + ' ms',
				_('Across enabled targets'), 'nm-c-ok'));
			kpi.appendChild(common.kpiCard(_('Current latency'), common.fmt.latency(o.current) + ' ms',
				_('Latest probe round'), 'nm-c-good'));
			kpi.appendChild(common.kpiCard(_('Packet loss'), common.fmt.percent(o.loss),
				_('Weighted by samples'), (o.loss > 5 ? 'nm-c-warn' : '')));
			kpi.appendChild(regionCard(_('China network'), cn));
			kpi.appendChild(regionCard(_('Overseas network'), ov));
			kpi.appendChild(common.kpiCard(_('Online targets'), String(o.online || 0),
				_('Abnormal') + ': ' + (o.offline || 0), 'nm-c-ok'));
		}

		function renderCards(d) {
			common.clear(cards);
			var list = d.targets || [];
			if (!list.length) {
				var e = common.el('div', 'nm-empty', _('No targets configured'));
				cards.appendChild(e);
				return;
			}
			for (var i = 0; i < list.length; i++)
				cards.appendChild(common.targetCard(list[i]));
		}

		function renderFoot(d) {
			common.clear(foot);
			var row = common.el('div', 'nm-row');
			row.appendChild(common.svgBox(icons.service(d.running, 30), ''));
			row.appendChild(common.el('div', '',
				(d.running ? _('Service running') : _('Service stopped')) +
				' · ' + _('Last update') + ': ' + common.fmt.ago(d.tick)));
			row.appendChild(common.el('div', 'nm-spacer'));

			function btn(label, fn, cls) {
				var b = common.el('button', 'nm-btn nm-btn-sm ' + (cls || ''), label);
				b.addEventListener('click', function() {
					b.disabled = true;
					fn().then(function() {
						common.notify(_('Operation completed'));
						update();
					}).catch(function(e) {
						common.notify(String(e.message || e), 'error');
					}).then(function() { b.disabled = false; });
				});
				return b;
			}

			row.appendChild(btn(_('Start'), common.api.startService, 'nm-btn-primary'));
			row.appendChild(btn(_('Stop'), common.api.stopService));
			row.appendChild(btn(_('Restart'), common.api.restartService));
			foot.appendChild(row);
		}

		function apply(d) {
			renderHero(d);
			renderBanners(d);
			renderKpi(d);
			renderCards(d);
			renderFoot(d);
		}

		function update() {
			return common.api.getStatus(true).then(apply).catch(function(e) {
				common.clear(cards);
				cards.appendChild(common.el('div', 'nm-empty', String(e.message || e)));
			});
		}

		if (first) apply(first);
		poll.add(update, refresh);

		return root;
	}
});
