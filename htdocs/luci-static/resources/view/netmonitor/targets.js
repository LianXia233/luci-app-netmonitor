/*
 * 目标管理页面：新增 / 编辑 / 删除 / 启用 / 禁用 / 上下移动 / 复制 / 批量操作
 */

'use strict';
'require view';
'require netmonitor.common as common';

return view.extend({
	load: function() {
		common.css();
		return Promise.all([
			common.loadI18n(),
			common.api.getTargets(),
			common.api.getConfig()
		]);
	},

	render: function(res) {
		common.css();

		var targets = ((res && res[1]) || {}).targets || [];
		var cfg = (res && res[2]) || {};
		var checked = {};

		var root = common.el('div', 'nm-root');
		var page = common.el('div', 'nm-page');
		root.appendChild(page);

		/* 工具栏 */
		var bar = common.el('div', 'nm-card');
		var row = common.el('div', 'nm-row');

		function toolBtn(label, fn, cls) {
			var b = common.el('button', 'nm-btn ' + (cls || ''), label);
			b.addEventListener('click', function() {
				b.disabled = true;
				Promise.resolve(fn()).then(function() {
					reload();
				}).catch(function(e) {
					common.notify(String(e.message || e), 'error');
				}).then(function() { b.disabled = false; });
			});
			return b;
		}

		row.appendChild(toolBtn(_('Add target'), function() { return openEditor(null); }, 'nm-btn-primary'));
		row.appendChild(toolBtn(_('Enable selected'), function() {
			return common.api.batchTargets(selectedIds(), true);
		}));
		row.appendChild(toolBtn(_('Disable selected'), function() {
			return common.api.batchTargets(selectedIds(), false);
		}));
		row.appendChild(toolBtn(_('Refresh'), function() { return Promise.resolve(); }));
		row.appendChild(common.el('div', 'nm-spacer'));
		row.appendChild(common.el('span', 'nm-card-sub',
			_('Global interval') + ': ' + (cfg.interval || 10) + 's · ' + _('Timeout') + ': ' + (cfg.timeout || 3) + 's'));
		bar.appendChild(row);
		page.appendChild(bar);

		var wrap = common.el('div', 'nm-table-wrap');
		var table = common.el('table', 'nm-table');
		var thead = common.el('thead', '');
		var tbody = common.el('tbody', '');
		var htr = common.el('tr', '');
		htr.appendChild(common.el('th', '', ''));
		[_('Name'), _('Address'), _('Region'), _('Label'), _('Family'), _('Interval'), _('Timeout'), _('Interface'), _('Enabled'), _('Actions')]
			.forEach(function(h) { htr.appendChild(common.el('th', '', h)); });
		thead.appendChild(htr);
		table.appendChild(thead);
		table.appendChild(tbody);
		wrap.appendChild(table);
		page.appendChild(wrap);

		var tip = common.el('div', 'nm-card-sub');
		tip.innerHTML = _('Interval and timeout set to 0 inherit the global settings.');
		page.appendChild(tip);

		function selectedIds() {
			var ids = [];
			for (var k in checked)
				if (checked[k]) ids.push(k);
			return ids;
		}

		function renderList(list) {
			common.clear(tbody);
			targets = list;
			if (!list.length) {
				var tr0 = common.el('tr', '');
				var td0 = common.el('td', 'nm-empty', _('No targets'));
				td0.colSpan = 11;
				tr0.appendChild(td0);
				tbody.appendChild(tr0);
				return;
			}

			for (var i = 0; i < list.length; i++) {
				(function(t, idx) {
					var tr = common.el('tr', '');

					var tdChk = common.el('td', '');
					var cb = common.el('input', '');
					cb.type = 'checkbox';
					cb.checked = !!checked[t.id];
					cb.addEventListener('change', function() { checked[t.id] = cb.checked; });
					tdChk.appendChild(cb);
					tr.appendChild(tdChk);

					tr.appendChild(common.el('td', '', t.name || t.id));
					tr.appendChild(common.el('td', 'nm-target-host', t.host || ''));

					var tdR = common.el('td', '');
					tdR.appendChild(common.el('span', common.regionTagClass(t.region), common.regionText(t.region)));
					tr.appendChild(tdR);

					tr.appendChild(common.el('td', '', t.label || '—'));

					var fam = { auto: _('Auto'), ipv4: _('IPv4'), ipv6: _('IPv6'), both: _('IPv4 + IPv6') };
					tr.appendChild(common.el('td', '', fam[t.family] || t.family));
					tr.appendChild(common.el('td', 'nm-num', (t.interval || 0) === 0 ? _('Global') : (t.interval + 's')));
					tr.appendChild(common.el('td', 'nm-num', (t.timeout || 0) === 0 ? _('Global') : (t.timeout + 's')));
					tr.appendChild(common.el('td', '', t.interface || '—'));

					var tdEn = common.el('td', '');
					var lab = common.el('label', 'nm-switch');
					var inp = common.el('input', '');
					inp.type = 'checkbox';
					inp.checked = !!t.enabled;
					inp.addEventListener('change', function() {
						common.api.updateTarget({ id: t.id, enabled: inp.checked }).then(reload).catch(function(e) {
							common.notify(String(e.message || e), 'error');
							inp.checked = !inp.checked;
						});
					});
					lab.appendChild(inp);
					lab.appendChild(common.el('i', ''));
					tdEn.appendChild(lab);
					tr.appendChild(tdEn);

					var tdAct = common.el('td', '');
					tdAct.style.whiteSpace = 'nowrap';

					function mini(label, fn) {
						var b = common.el('button', 'nm-btn nm-btn-sm', label);
						b.style.marginRight = '4px';
						b.addEventListener('click', function() {
							b.disabled = true;
							Promise.resolve(fn()).then(reload).catch(function(e) {
								common.notify(String(e.message || e), 'error');
							}).then(function() { b.disabled = false; });
						});
						return b;
					}

					tdAct.appendChild(mini(_('Edit'), function() { return openEditor(t); }));
					tdAct.appendChild(mini('↑', function() { return common.api.moveTarget(t.id, -1); }));
					tdAct.appendChild(mini('↓', function() { return common.api.moveTarget(t.id, 1); }));
					tdAct.appendChild(mini(_('Copy'), function() { return common.api.copyTarget(t.id); }));
					tdAct.appendChild(mini(_('Delete'), function() {
						if (!window.confirm(_('Delete this target?') + ' (' + (t.name || t.id) + ')'))
							return Promise.resolve();
						return common.api.deleteTarget(t.id);
					}));

					tr.appendChild(tdAct);
					tbody.appendChild(tr);
				})(list[i], i);
			}
		}

		/* 编辑弹窗 */
		function openEditor(t) {
			var modal = common.el('div', 'nm-modal');
			var box = common.el('div', 'nm-modal-box');

			box.appendChild(common.el('h3', 'nm-modal-title', t ? _('Edit target') : _('Add target')));

			var fields = {};

			function field(label, key, control) {
				var f = common.el('div', 'nm-field');
				f.appendChild(common.el('label', '', label));
				f.appendChild(control);
				fields[key] = control;
				box.appendChild(f);
			}

			function input(cls, value) {
				var i = common.el('input', cls || 'nm-input');
				i.value = (value == null ? '' : value);
				i.type = 'text';
				return i;
			}

			function select(options, value) {
				var s = common.el('select', 'nm-select');
				options.forEach(function(o) {
					var op = common.el('option', '', o[1]);
					op.value = o[0];
					s.appendChild(op);
				});
				s.value = value;
				return s;
			}

			field(_('Name'), 'name', input('', t ? t.name : ''));
			field(_('Address'), 'host', input('', t ? t.host : ''));
			field(_('Region'), 'region', select([
				['cn', _('China')], ['overseas', _('Overseas')], ['other', _('Other')]
			], t ? t.region : 'cn'));
			field(_('Custom label'), 'label', input('', t ? t.label : ''));
			field(_('Address family'), 'family', select([
				['auto', _('Auto')], ['ipv4', _('IPv4 only')], ['ipv6', _('IPv6 only')], ['both', _('IPv4 + IPv6')]
			], t ? t.family : 'auto'));
			field(_('Check interval (s, 0 = global)'), 'interval', input('', t ? t.interval : 0));
			field(_('Timeout (s, 0 = global)'), 'timeout', input('', t ? t.timeout : 0));
			field(_('Interface (optional)'), 'interface', input('', t ? t.interface : ''));
			field(_('Source address (optional)'), 'source', input('', t ? t.source : ''));
			field(_('Remark'), 'remark', input('', t ? t.remark : ''));

			var enRow = common.el('div', 'nm-row');
			var lab = common.el('label', 'nm-switch');
			var enInp = common.el('input', '');
			enInp.type = 'checkbox';
			enInp.checked = t ? !!t.enabled : true;
			lab.appendChild(enInp);
			lab.appendChild(common.el('i', ''));
			lab.appendChild(common.el('span', '', _('Enabled')));
			enRow.appendChild(lab);
			box.appendChild(enRow);

			var errBox = common.el('div', 'nm-modal-error');
			box.appendChild(errBox);

			var actions = common.el('div', 'nm-modal-actions');
			var btnCancel = common.el('button', 'nm-btn', _('Cancel'));
			var btnSave = common.el('button', 'nm-btn nm-btn-primary', _('Save'));

			function close() {
				if (modal.parentNode) modal.parentNode.removeChild(modal);
			}
			btnCancel.addEventListener('click', close);

			btnSave.addEventListener('click', function() {
				var data = {
					name: fields.name.value.trim(),
					host: fields.host.value.trim(),
					region: fields.region.value,
					label: fields.label.value.trim(),
					family: fields.family.value,
					interval: parseInt(fields.interval.value, 10) || 0,
					timeout: parseInt(fields.timeout.value, 10) || 0,
					interface: fields.interface.value.trim(),
					source: fields.source.value.trim(),
					remark: fields.remark.value.trim(),
					enabled: enInp.checked
				};
				if (!data.name || !data.host) {
					errBox.textContent = _('Name and address are required');
					return;
				}
				btnSave.disabled = true;
				var p = t ? common.api.updateTarget(Object.assign({ id: t.id }, data))
				          : common.api.addTarget(data);
				p.then(function() {
					close();
					reload();
					common.notify(_('Saved'));
				}).catch(function(e) {
					errBox.textContent = String(e.message || e);
					btnSave.disabled = false;
				});
			});

			actions.appendChild(btnCancel);
			actions.appendChild(btnSave);
			box.appendChild(actions);

			modal.appendChild(box);
			modal.addEventListener('click', function(ev) {
				if (ev.target === modal) close();
			});
			document.body.appendChild(modal);
			return Promise.resolve();
		}

		function reload() {
			return common.api.getTargets().then(function(d) {
				renderList(d.targets || []);
			});
		}

		renderList(targets);
		return root;
	}
});
