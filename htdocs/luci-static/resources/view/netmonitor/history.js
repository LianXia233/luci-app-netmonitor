/*
 * 历史数据页面：按时间范围 / 目标 / 区域查看聚合统计与曲线
 */

'use strict';
'require view';
'require netmonitor.common as common';
'require netmonitor.chart as chart';

var RANGES = [
	['15m', '15 min'], ['30m', '30 min'], ['1h', '1 hour'], ['6h', '6 hours'],
	['12h', '12 hours'], ['24h', '24 hours'], ['3d', '3 days'], ['7d', '7 days'], ['30d', '30 days']
];

return view.extend({
	load: function() {
		common.css();
		return Promise.all([
			common.loadI18n(),
			common.api.getConfig(),
			common.api.getTargets()
		]);
	},

	render: function(res) {
		common.css();

		var cfg = (res && res[1]) || {};
		var targets = ((res && res[2]) || {}).targets || [];

		var root = common.el('div', 'nm-root');
		var page = common.el('div', 'nm-page');
		root.appendChild(page);

		var bar = common.el('div', 'nm-card');
		var row = common.el('div', 'nm-row');

		var fRange = common.el('div', 'nm-field');
		var selRange = common.el('select', 'nm-select');
		RANGES.forEach(function(r) {
			var op = common.el('option', '', _(r[1]));
			op.value = r[0];
			selRange.appendChild(op);
		});
		selRange.value = '6h';
		fRange.appendChild(common.el('label', '', _('Time range')));
		fRange.appendChild(selRange);
		row.appendChild(fRange);

		var fRegion = common.el('div', 'nm-field');
		var selRegion = common.el('select', 'nm-select');
		[['all', _('All regions')], ['cn', _('China')], ['overseas', _('Overseas')], ['other', _('Other')]].forEach(function(o) {
			var op = common.el('option', '', o[1]);
			op.value = o[0];
			selRegion.appendChild(op);
		});
		fRegion.appendChild(common.el('label', '', _('Region')));
		fRegion.appendChild(selRegion);
		row.appendChild(fRegion);

		var fTarget = common.el('div', 'nm-field');
		var selTarget = common.el('select', 'nm-select');
		var opAll = common.el('option', '', _('All targets'));
		opAll.value = 'all';
		selTarget.appendChild(opAll);
		targets.forEach(function(t) {
			var op = common.el('option', '', t.name || t.id);
			op.value = t.id;
			selTarget.appendChild(op);
		});
		fTarget.appendChild(common.el('label', '', _('Target')));
		fTarget.appendChild(selTarget);
		row.appendChild(fTarget);

		row.appendChild(common.el('div', 'nm-spacer'));

		var btnQuery = common.el('button', 'nm-btn nm-btn-primary', _('Query'));
		row.appendChild(btnQuery);
		bar.appendChild(row);

		var note = common.el('div', 'nm-card-sub');
		note.style.marginTop = '8px';
		if (cfg.persistence !== '1')
			note.textContent = _('History persistence is disabled. Ranges longer than the in-memory buffer may have no data.');
		bar.appendChild(note);
		page.appendChild(bar);

		var statCard = common.el('div', 'nm-card');
		statCard.appendChild(common.el('div', 'nm-card-title', _('Statistics')));
		var statWrap = common.el('div', 'nm-table-wrap');
		var statTable = common.el('table', 'nm-table');
		var statHead = common.el('thead', '');
		var statBody = common.el('tbody', '');
		var htr = common.el('tr', '');
		[_('Target'), _('Region'), _('Samples'), _('Average'), _('Min'), _('Max'), _('P50'), _('P95'), _('Loss'), _('Uptime')]
			.forEach(function(h) { htr.appendChild(common.el('th', '', h)); });
		statHead.appendChild(htr);
		statTable.appendChild(statHead);
		statTable.appendChild(statBody);
		statWrap.appendChild(statTable);
		statCard.appendChild(statWrap);
		page.appendChild(statCard);

		var chartCard = common.el('div', 'nm-card');
		chartCard.appendChild(common.el('div', 'nm-card-title', _('Latency trend')));
		var chartBox = common.el('div', 'nm-chart-box');
		chartCard.appendChild(chartBox);
		var legend = common.el('div', 'nm-chart-legend');
		chartCard.appendChild(legend);
		page.appendChild(chartCard);

		function query() {
			var range = selRange.value;
			var region = selRegion.value;
			var target = selTarget.value;

			btnQuery.disabled = true;
			return Promise.all([
				common.api.getStatistics({ range: range, region: region, target: target }),
				common.api.getHistory({ range: range, region: region, target: target, max_points: 600 })
			]).then(function(r) {
				var st = r[0];
				var hi = r[1];
				renderStats(st);
				renderChart(hi);
			}).catch(function(e) {
				common.notify(String(e.message || e), 'error');
			}).then(function() {
				btnQuery.disabled = false;
			});
		}

		function renderStats(st) {
			common.clear(statBody);
			var rows = st.targets || [];
			if (!rows.length) {
				var tr0 = common.el('tr', '');
				var td0 = common.el('td', 'nm-empty', _('No data in this range'));
				td0.colSpan = 10;
				tr0.appendChild(td0);
				statBody.appendChild(tr0);
				return;
			}
			for (var i = 0; i < rows.length; i++) {
				var t = rows[i];
				var tr = common.el('tr', '');
				tr.appendChild(common.el('td', '', t.name || t.id));
				var tdR = common.el('td', '');
				tdR.appendChild(common.el('span', common.regionTagClass(t.region), common.regionText(t.region)));
				tr.appendChild(tdR);
				tr.appendChild(common.el('td', 'nm-num', String(t.samples || 0)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.latency(t.avg)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.latency(t.min)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.latency(t.max)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.latency(t.p50)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.latency(t.p95)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.percent(t.loss)));
				tr.appendChild(common.el('td', 'nm-num', common.fmt.percent(t.success_rate, 0)));
				statBody.appendChild(tr);
			}
		}

		function renderChart(hi) {
			common.clear(chartBox);
			common.clear(legend);
			var series = [];
			for (var i = 0; i < hi.series.length; i++) {
				if (!hi.series[i].points.length) continue;
				series.push({
					name: hi.series[i].name,
					color: common.palette[i % common.palette.length],
					points: hi.series[i].points
				});
			}
			if (!series.length) {
				chartBox.appendChild(common.el('div', 'nm-empty', _('No data in this range')));
				return;
			}
			chart.mount(chartBox, series, { height: 250, area: (series.length === 1) });
			for (var k = 0; k < series.length; k++) {
				var item = common.el('span', '');
				var ic = common.el('i', '');
				ic.style.background = series[k].color;
				item.appendChild(ic);
				item.appendChild(document.createTextNode(series[k].name));
				legend.appendChild(item);
			}
		}

		btnQuery.addEventListener('click', query);
		selRange.addEventListener('change', query);
		selRegion.addEventListener('change', query);
		selTarget.addEventListener('change', query);

		query();

		return root;
	}
});
