/*
 * 目标管理页面：新增 / 编辑 / 删除 / 启用 / 禁用 / 上下移动 / 复制 / 批量操作
 * TDesign Web Components 重构版本
 * 工具栏 / 按钮 / 标签 / 开关 / 弹窗 / 表单由 <t-*> 组件承载，
 * 明细表格保留 .nm-table 平面结构（t-table 的列配置在 WC 版渲染成本高，
 * 且本表含动态 SVG / 开关 / 按钮混合单元格，手写结构更可控）。
 */

'use strict';
'require view';
'require netmonitor.common as common';
'require netmonitor.icons as icons';

return view.extend({
	load: function() {
		common.css();
		return Promise.all([
			common.loadI18n(),
			common.tdesign(),
			common.api.getTargets(),
			common.api.getConfig()
		]);
	},

	render: function(res) {
		common.css();

		var targets = ((res && res[2]) || {}).targets || [];
		var cfg = (res && res[3]) || {};
		var checked = {};

		var root = common.el('div', 'nm-root');
		var page = common.el('div', 'nm-page');
		root.appendChild(page);

		/* 工具栏 */
		var bar = document.createElement('t-card');
		bar.setAttribute('bordered', 'true');
		var row = common.el('div', 'nm-row');
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.flexWrap = 'wrap';
		row.style.gap = '12px';
		row.style.width = '100%';

		function toolBtn(label, fn, isPrimary, svgIcon) {
			var b = document.createElement('t-button');
			b.setAttribute('theme', isPrimary ? 'primary' : 'default');
			if (!isPrimary) b.setAttribute('variant', 'outline');
			if (svgIcon) {
				var icBox = common.el('span', '');
				icBox.innerHTML = svgIcon;
				b.appendChild(icBox);
			}
			b.appendChild(document.createTextNode(label));
			b.addEventListener('click', function() {
				b.setAttribute('disabled', '');
				Promise.resolve(fn()).then(function() {
					reload();
				}).catch(function(e) {
					common.notify(String(e.message || e), 'error');
				}).then(function() { b.removeAttribute('disabled'); });
			});
			return b;
		}

		var addSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H9v4a1 1 0 1 1-2 0V9H3a1 1 0 0 1 0-2h4V3a1 1 0 0 1 1-1z"/></svg>`;
		var okSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M13.485 1.929a1 1 0 0 1 1.414 1.414L6.343 11.899 1.1 6.657a1 1 0 0 1 1.414-1.414l3.829 3.829 7.142-7.143z"/></svg>`;
		var disSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="2"/></svg>`;
		var refSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.9 4.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>`;

		row.appendChild(toolBtn(_('Add target'), function() { return openEditor(null); }, true, addSvg));
		row.appendChild(toolBtn(_('Enable selected'), function() {
			return common.api.batchTargets(selectedIds(), true);
		}, false, okSvg));
		row.appendChild(toolBtn(_('Disable selected'), function() {
			return common.api.batchTargets(selectedIds(), false);
		}, false, disSvg));
		row.appendChild(toolBtn(_('Refresh'), function() { return Promise.resolve(); }, false, refSvg));

		var spacer = common.el('div', 'nm-spacer');
		spacer.style.flex = '1';
		row.appendChild(spacer);

		var summary = common.el('div', 'nm-summary-pill');
		var sumIconBox = common.el('span', 'nm-inline-icon');
		sumIconBox.innerHTML = icons.multiTarget(targets, 30);
		summary.appendChild(sumIconBox);
		var sumProto = (cfg.default_proto === 'tcp')
			? ('TCP:' + (cfg.default_tcp_port || 80)) : 'ICMP';
		summary.appendChild(common.el('span', '',
			_('Default probe method') + ': ' + sumProto + ' · ' +
			_('Global interval') + ': ' + (cfg.interval || 10) + 's · ' +
			_('Timeout') + ': ' + (cfg.timeout || 3) + 's'));
		row.appendChild(summary);
		bar.appendChild(row);
		page.appendChild(bar);

		var wrap = common.el('div', 'nm-table-wrap');
		var table = common.el('table', 'nm-table');
		var thead = common.el('thead', '');
		var tbody = common.el('tbody', '');
		var htr = common.el('tr', '');
		htr.appendChild(common.el('th', '', ''));
		[_('Name'), _('Address'), _('Probe method'), _('Region'), _('Custom label'), _('Family'),
		 _('Interval'), _('Timeout'), _('Interface'), _('Enabled'), _('Actions')]
			.forEach(function(h) { htr.appendChild(common.el('th', '', h)); });
		thead.appendChild(htr);
		table.appendChild(thead);
		table.appendChild(tbody);
		wrap.appendChild(table);
		page.appendChild(wrap);

		var tipRow = document.createElement('t-card');
		tipRow.setAttribute('bordered', 'true');
		var tipText = common.el('div', '');
		tipText.innerHTML = _('Interval and timeout set to 0 inherit the global settings.') +
			' · ' + _('The table scrolls horizontally on small screens.');
		tipRow.appendChild(tipText);
		tipRow.style.fontSize = '12px';
		tipRow.style.color = 'var(--nm-muted)';
		page.appendChild(tipRow);

		function selectedIds() {
			var ids = [];
			for (var k in checked)
				if (checked[k]) ids.push(k);
			return ids;
		}

		/* TDesign 标签：协议 / 区域胶囊 */
		function protoTag(t) {
			var isTcp = (t.proto === 'tcp');
			var tag = document.createElement('t-tag');
			tag.setAttribute('theme', isTcp ? 'primary' : 'success');
			tag.setAttribute('variant', 'light');
			var text;
			if (isTcp) {
				var tport = (t.tcp_port || 0) > 0 ? t.tcp_port : (cfg.default_tcp_port || 80);
				text = 'TCP:' + tport;
			} else {
				text = 'ICMP';
			}
			tag.textContent = text;
			return tag;
		}

		function regionTag(t) {
			var tag = document.createElement('t-tag');
			var theme = 'default', variant = 'outline';
			if (t.region === 'cn') { theme = 'primary'; variant = 'light-outline'; }
			else if (t.region === 'overseas') { theme = 'warning'; variant = 'light-outline'; }
			tag.setAttribute('theme', theme);
			tag.setAttribute('variant', variant);
			tag.textContent = common.regionText(t.region);
			return tag;
		}

		function renderList(list) {
			common.clear(tbody);
			targets = list;
			sumIconBox.innerHTML = icons.multiTarget(list, 30);
			if (!list.length) {
				var tr0 = common.el('tr', '');
				var td0 = common.el('td', 'nm-empty', _('No targets'));
				td0.colSpan = 12;
				td0.style.padding = '36px';
				td0.style.textAlign = 'center';
				tr0.appendChild(td0);
				tbody.appendChild(tr0);
				return;
			}

			for (var i = 0; i < list.length; i++) {
				(function(t, idx) {
					var tr = common.el('tr', '');
					tr.setAttribute('data-id', t.id);

					var tdChk = common.el('td', '');
					tdChk.style.textAlign = 'center';
					var cb = common.el('input', '');
					cb.type = 'checkbox';
					cb.checked = !!checked[t.id];
					cb.addEventListener('change', function() { checked[t.id] = cb.checked; });
					tdChk.appendChild(cb);
					tr.appendChild(tdChk);

					tr.appendChild(common.el('td', 'nm-target-name', t.name || t.id));
					tr.appendChild(common.el('td', 'nm-target-host', t.host || ''));

					var tdMethod = common.el('td', '');
					var badge = protoTag(t);
					badge.title = (t.proto === 'tcp')
						? (_('TCP connect') + (((t.tcp_port || 0) > 0) ? '' : ' · ' + _('global default port')))
						: _('ICMP (ping)');
					tdMethod.appendChild(badge);
					tr.appendChild(tdMethod);

					var tdR = common.el('td', '');
					tdR.appendChild(regionTag(t));
					tr.appendChild(tdR);

					tr.appendChild(common.el('td', '', t.label || '—'));

					var fam = { auto: _('Auto'), ipv4: _('IPv4'), ipv6: _('IPv6'), both: _('IPv4 + IPv6') };
					var tdFam = common.el('td', '');
					tdFam.style.whiteSpace = 'nowrap';
					tdFam.appendChild(common.inlineIcon(icons.dualStack(t.family, true, true, 20)));
					tdFam.appendChild(document.createTextNode(' ' + (fam[t.family] || t.family)));
					tr.appendChild(tdFam);

					tr.appendChild(common.el('td', 'nm-num', (t.interval || 0) === 0 ? _('Global') : (t.interval + 's')));
					tr.appendChild(common.el('td', 'nm-num', (t.timeout || 0) === 0 ? _('Global') : (t.timeout + 's')));
					tr.appendChild(common.el('td', '', t.interface || '—'));

					/* 启用状态切换开关（TDesign） */
					var tdEn = common.el('td', '');
					tdEn.style.whiteSpace = 'nowrap';
					tdEn.appendChild(common.inlineIcon(icons.online(18, !!t.enabled)));
					var sw = document.createElement('t-switch');
					sw.value = !!t.enabled;
					sw.addEventListener('change', function(e) {
						var v = !!(e.detail && e.detail.value);
						common.api.updateTarget({ id: t.id, enabled: v }).then(reload).catch(function(err) {
							common.notify(String(err.message || err), 'error');
							sw.value = !v;
						});
					});
					tdEn.appendChild(sw);
					tr.appendChild(tdEn);

					/* 操作按钮组（TDesign 文本按钮） */
					var tdAct = common.el('td', '');
					tdAct.style.whiteSpace = 'nowrap';

					function mini(label, fn, isDanger) {
						var b = document.createElement('t-button');
						b.setAttribute('theme', isDanger ? 'danger' : 'default');
						b.setAttribute('variant', 'text');
						b.setAttribute('size', 'small');
						b.textContent = label;
						b.addEventListener('click', function() {
							b.setAttribute('disabled', '');
							Promise.resolve(fn()).then(reload).catch(function(e) {
								common.notify(String(e.message || e), 'error');
							}).then(function() { b.removeAttribute('disabled'); });
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
					}, true));

					tr.appendChild(tdAct);
					tbody.appendChild(tr);
				})(list[i], i);
			}
		}

		/* 编辑弹窗（TDesign t-dialog + t-input / t-select / t-input-number / t-switch） */
		function openEditor(t) {
			var modal = document.createElement('t-dialog');
			modal.setAttribute('header', t ? _('Edit target') : _('Add target'));
			modal.setAttribute('width', '560px');
			modal.visible = true;

			var body = common.el('div', 'nm-dialog-body');
			var fields = {};

			function field(label, key, control) {
				var f = common.el('div', 'nm-field');
				control.setAttribute('data-nm-key', key);
				f.appendChild(common.el('label', '', label));
				f.appendChild(control);
				fields[key] = control;
				body.appendChild(f);
			}

			function tinput(value, extra) {
				var i = document.createElement('t-input');
				if (value != null && value !== '') i.value = String(value);
				if (extra) {
					if (extra.placeholder) i.setAttribute('placeholder', extra.placeholder);
					if (extra.maxlength) i.setAttribute('maxlength', String(extra.maxlength));
				}
				return i;
			}

			function tnum(value, extra) {
				var n = document.createElement('t-input-number');
				if (value != null) n.value = value;
				if (extra) {
					if (extra.min != null) n.min = extra.min;
					if (extra.max != null) n.max = extra.max;
				}
				return n;
			}

			function tselect(options, value) {
				var s = document.createElement('t-select');
				s.options = options;
				s.value = value;
				return s;
			}

			var protoSel = tselect([
				{ label: _('ICMP (ping)'), value: 'icmp' },
				{ label: _('TCP connect'), value: 'tcp' }
			], t ? (t.proto || 'icmp') : (cfg.default_proto || 'icmp'));

			var portInp = tnum((t && t.tcp_port) ? t.tcp_port : 0, { min: 0, max: 65535 });

			function syncProto() {
				var isTcp = (protoSel.value === 'tcp');
				portInp.disabled = !isTcp;
				portInp.setAttribute('placeholder', isTcp
					? String(cfg.default_tcp_port || 80)
					: _('Not used by ICMP'));
				portInp.style.opacity = isTcp ? '1' : '0.5';
			}
			protoSel.addEventListener('change', syncProto);

			field(_('Name'), 'name', tinput(t ? t.name : ''));
			field(_('Address'), 'host', tinput(t ? t.host : ''));
			field(_('Probe method'), 'proto', protoSel);
			field(_('TCP port (0 = global default)'), 'tcp_port', portInp);
			field(_('Region'), 'region', tselect([
				{ label: _('China'), value: 'cn' },
				{ label: _('Overseas'), value: 'overseas' },
				{ label: _('Other'), value: 'other' }
			], t ? t.region : 'cn'));
			field(_('Custom label'), 'label', tinput(t ? t.label : ''));
			field(_('Address family'), 'family', tselect([
				{ label: _('Auto'), value: 'auto' },
				{ label: _('IPv4 only'), value: 'ipv4' },
				{ label: _('IPv6 only'), value: 'ipv6' },
				{ label: _('IPv4 + IPv6'), value: 'both' }
			], t ? t.family : 'auto'));
			field(_('Check interval (s, 0 = global)'), 'interval', tnum(t ? t.interval : 0, { min: 0, max: 86400 }));
			field(_('Timeout (s, 0 = global)'), 'timeout', tnum(t ? t.timeout : 0, { min: 0, max: 600 }));
			field(_('Interface (optional)'), 'interface', tinput(t ? t.interface : ''));
			field(_('Source address (optional)'), 'source', tinput(t ? t.source : ''));
			field(_('Remark'), 'remark', tinput(t ? t.remark : ''));
			syncProto();

			var enRow = common.el('div', 'nm-row');
			enRow.style.display = 'flex';
			enRow.style.alignItems = 'center';
			enRow.style.gap = '10px';
			enRow.style.margin = '10px 0';
			var enSw = document.createElement('t-switch');
			enSw.value = t ? !!t.enabled : true;
			enRow.appendChild(enSw);
			enRow.appendChild(common.el('span', '', _('Enabled')));
			body.appendChild(enRow);

			var errBox = common.el('div', 'nm-modal-error');
			body.appendChild(errBox);

			modal.appendChild(body);

			var footer = common.el('div', 'nm-modal-actions');
			var btnCancel = document.createElement('t-button');
			btnCancel.setAttribute('theme', 'default');
			btnCancel.setAttribute('variant', 'outline');
			btnCancel.textContent = _('Cancel');
			var btnSave = document.createElement('t-button');
			btnSave.setAttribute('theme', 'primary');
			btnSave.textContent = _('Save & Apply');
			footer.appendChild(btnCancel);
			footer.appendChild(btnSave);

			var slot = common.el('div');
			slot.setAttribute('slot', 'footer');
			slot.appendChild(footer);
			modal.appendChild(slot);

			function close() {
				modal.visible = false;
				if (modal.parentNode) modal.parentNode.removeChild(modal);
			}
			btnCancel.addEventListener('click', close);
			/* t-dialog 关闭（遮罩 / ESC）后同步移除节点，避免残留 */
			modal.addEventListener('visible-change', function(e) {
				if (!(e.detail === true)) close();
			});

			btnSave.addEventListener('click', function() {
				var proto = fields.proto.value;
				var port = parseInt(fields.tcp_port.value, 10);
				if (isNaN(port) || port < 0) port = 0;
				if (port > 65535) port = 65535;
				if (proto !== 'tcp') port = 0;

				var data = {
					name: String(fields.name.value || '').trim(),
					host: String(fields.host.value || '').trim(),
					proto: proto,
					tcp_port: port,
					region: fields.region.value,
					label: String(fields.label.value || '').trim(),
					family: fields.family.value,
					interval: parseInt(fields.interval.value, 10) || 0,
					timeout: parseInt(fields.timeout.value, 10) || 0,
					interface: String(fields.interface.value || '').trim(),
					source: String(fields.source.value || '').trim(),
					remark: String(fields.remark.value || '').trim(),
					enabled: enSw.value ? '1' : '0'
				};
				if (!data.name || !data.host) {
					errBox.textContent = _('Name and address are required');
					return;
				}
				if (proto === 'tcp' && port === 0 && !(cfg.default_tcp_port > 0)) {
					errBox.textContent = _('TCP targets need a port or a global default port');
					return;
				}
				btnSave.setAttribute('disabled', '');
				btnCancel.setAttribute('disabled', '');

				var p;
				if (t) {
					var ops = [];
					for (var k in data)
						ops.push({ sid: t.id, opt: k, val: data[k] });
					p = common.saveConfig(ops);
				} else {
					p = common.addSection('netmonitor', 'target', data);
				}
				p.then(function(changed) {
					if (changed === 0) {
						close();
						common.notify(_('No changes to save'));
						return;
					}
					close();
					return common.applyChanges();
				}).catch(function(e) {
					if (!modal.parentNode) return;
					errBox.textContent = String(e.message || e);
					btnSave.removeAttribute('disabled');
					btnCancel.removeAttribute('disabled');
				});
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
