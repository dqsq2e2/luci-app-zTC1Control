'use strict';

'require view';
'require rpc';
'require ui';
'require form';

var callStatus = rpc.declare({
	object: 'luci.ztc1control',
	method: 'status',
	expect: { '': {} }
});

var callScan = rpc.declare({
	object: 'luci.ztc1control',
	method: 'scan',
	expect: { '': {} }
});

var callPlug = rpc.declare({
	object: 'luci.ztc1control',
	method: 'plug',
	params: [ 'mac', 'plug', 'on' ],
	expect: { '': {} }
});

var callQuery = rpc.declare({
	object: 'luci.ztc1control',
	method: 'query',
	params: [ 'mac' ],
	expect: { '': {} }
});

var callLocks = rpc.declare({
	object: 'luci.ztc1control',
	method: 'locks',
	params: [ 'mac', 'child_lock', 'led_lock' ],
	expect: { '': {} }
});

var callActivate = rpc.declare({
	object: 'luci.ztc1control',
	method: 'activate',
	params: [ 'mac', 'code' ],
	expect: { '': {} }
});

var callCheckApiPort = rpc.declare({
	object: 'luci.ztc1control',
	method: 'check_api_port',
	params: [ 'port' ],
	expect: { '': {} }
});

var callTimer = rpc.declare({
	object: 'luci.ztc1control',
	method: 'timer',
	params: [ 'mac', 'plug', 'task', 'hour', 'minute', 'repeat', 'action', 'enable' ],
	expect: { '': {} }
});

var callCountdown = rpc.declare({
	object: 'luci.ztc1control',
	method: 'countdown',
	params: [ 'mac', 'plug', 'seconds', 'action' ],
	expect: { '': {} }
});

var callCancelCountdown = rpc.declare({
	object: 'luci.ztc1control',
	method: 'cancel_countdown',
	params: [ 'id' ],
	expect: { '': {} }
});

var callRename = rpc.declare({
	object: 'luci.ztc1control',
	method: 'rename',
	params: [ 'mac', 'name', 'plugs' ],
	expect: { '': {} }
});

function notify(message, level) {
	ui.addNotification(null, E('p', {}, [ String(message) ]), level || 'info');
}

function failure(message) {
	notify(message, 'error');
}

function ensureOk(result, fallback) {
	if (!result || result.ok !== true)
		throw new Error((result && result.error) || fallback || '操作失败');

	return result;
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function formatDuration(seconds) {
	var value = Number(seconds) || 0;
	var hours = Math.floor(value / 3600);
	var minutes = Math.floor((value % 3600) / 60);

	return hours + ' 小时 ' + minutes + ' 分';
}

function formatRemain(seconds) {
	var value = Math.max(0, Number(seconds) || 0);

	if (value >= 3600)
		return Math.floor(value / 3600) + ' 小时 ' + Math.floor((value % 3600) / 60) + ' 分';

	if (value >= 60)
		return Math.floor(value / 60) + ' 分钟';

	return value + ' 秒';
}

function serviceText(status) {
	var service = (status && status.service) || {};

	if (!service.enabled)
		return '服务已禁用';

	return service.running ? '服务运行中' : '服务未运行';
}

function field(label, input) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, [ label ]),
		E('div', { 'class': 'cbi-value-field' }, [ input ])
	]);
}

function selectBox(options, current) {
	var select = E('select', { 'class': 'cbi-input-select' });

	for (var i = 0; i < options.length; i++) {
		var option = E('option', { 'value': String(options[i][0]) }, [ options[i][1] ]);

		if (String(options[i][0]) === String(current))
			option.selected = true;

		select.appendChild(option);
	}

	return select;
}

function textInput(value, extra) {
	var input = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'maxlength': '64' });

	input.value = value || '';

	if (extra) {
		for (var key in extra)
			input.setAttribute(key, extra[key]);
	}

	return input;
}

function utf8Bytes(value) {
	var str = String(value == null ? '' : value);

	if (typeof TextEncoder !== 'undefined')
		return new TextEncoder().encode(str).length;

	return unescape(encodeURIComponent(str)).length;
}

function utf8Chars(value) {
	return Array.from(String(value == null ? '' : value)).length;
}

function plugOptions(device) {
	var options = [];

	for (var i = 0; i < 6; i++) {
		var plug = (device.plugs && device.plugs[i]) || {};
		var name = plug.name || ('插口 ' + (i + 1));

		options.push([ i, name ]);
	}

	return options;
}

function plugLabel(device, index) {
	var plug = (device.plugs && device.plugs[index]) || {};

	return plug.name || ('插口 ' + (index + 1));
}

function settingsRequested() {
	return /(?:^|[?&])settings=1(?:&|$)/.test(String(window.location.search || ''));
}

function hideDevicesFooter(hide) {
	var style = document.getElementById('ztc1-footer-style');

	if (hide) {
		if (!style) {
			style = E('style', { 'id': 'ztc1-footer-style' },
				[ '#view > .cbi-page-actions { display: none !important; }' ]);
			document.head.appendChild(style);
		}
	}
	else if (style) {
		style.parentNode.removeChild(style);
	}
}

return view.extend({
	handleSave: function(ev) {
		var self = this;

		if (!settingsRequested())
			return view.prototype.handleSave.call(self, ev);

		var enabled = document.querySelector('[data-field="cbid.ztc1control.main.api_enabled"] input[type="checkbox"]');
		var portField = document.querySelector('[data-field="cbid.ztc1control.main.api_port"] input');

		if (!enabled || !enabled.checked || !portField)
			return view.prototype.handleSave.call(self, ev);

		var port = Number(portField.value || 0);

		if (!port || port < 1 || port > 65535) {
			ui.addNotification(null, E('p', {}, [ 'API 端口无效，请填写 1-65535 之间的端口' ]), 'error');
			return Promise.reject(new Error('invalid API port'));
		}

		return callCheckApiPort(port).then(function(result) {
			if (!result || result.free !== true)
				throw new Error('API 端口 ' + port + ' 已被占用，请换一个端口后再保存');

			return view.prototype.handleSave.call(self, ev);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [ err.message ]), 'error');
			throw err;
		});
	},

	load: function() {
		if (settingsRequested())
			return {};

		return L.resolveDefault(callStatus(), {});
	},

	renderSettings: function() {
		var m, s, o;

		hideDevicesFooter(false);

		m = new form.Map('ztc1control', 'zTC1 服务设置',
			'配置 zTC1 智能排插的局域网 UDP 服务与外部 HTTP API。修改后点击“保存并应用”以重启服务。');

		s = m.section(form.NamedSection, 'main', 'ztc1control');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', '启用设备服务',
			'关闭后不再监听 UDP 端口，也不会自动扫描设备。');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'listen_port', '监听端口',
			'接收设备上报数据的 UDP 端口，zTC1 默认为 10181。');
		o.datatype = 'port';
		o.default = '10181';
		o.rmempty = false;

		o = s.option(form.Value, 'command_port', '命令端口',
			'向设备发送命令的 UDP 端口，zTC1 默认为 10182。');
		o.datatype = 'port';
		o.default = '10182';
		o.rmempty = false;

		o = s.option(form.Value, 'broadcast', '广播地址',
			'auto 表示根据 LAN 接口自动计算定向广播地址；也可以手动填写类似 192.168.1.255 的地址。');
		o.default = 'auto';
		o.placeholder = 'auto';
		o.validate = function(section_id, value) {
			value = String(value || '').trim();

			if (value === '' || value === 'auto')
				return true;

			var match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);

			if (!match)
				return '请输入 auto 或合法的 IPv4 地址';

			for (var i = 1; i <= 4; i++) {
				if (Number(match[i]) > 255)
					return 'IPv4 地址超出范围';
			}

			return true;
		};

		o = s.option(form.Value, 'bind_interface', '绑定接口',
			'auto 表示使用 LAN 接口（推荐）；none 表示不绑定；也可以填写 br-lan 之类的设备名。');
		o.default = 'auto';
		o.placeholder = 'auto';

		o = s.option(form.Value, 'scan_interval', '自动扫描间隔',
			'定期发送设备发现广播的间隔（秒），0 表示禁用自动扫描，仍可在设备页手动扫描。');
		o.datatype = 'uinteger';
		o.default = '60';
		o.rmempty = false;

		o = s.option(form.Flag, 'api_enabled', '启用外部 API',
			'在指定端口启动 HTTP API 服务，供脚本、Home Assistant 等外部程序调用。默认关闭。');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'api_port', 'API 端口',
			'HTTP API 监听端口，默认 8091。所有接口都需要 API Key。');
		o.datatype = 'port';
		o.default = '8091';
		o.rmempty = false;

		o = s.option(form.Value, 'api_key', 'API Key',
			'调用 API 时通过 Authorization: Bearer 请求头传递。留空时服务启动会自动生成。');
		o.rmempty = true;
		o.placeholder = '留空自动生成';

		return m.render().then(function(formNode) {
			return E('div', {}, [
				E('div', { 'style': 'margin-bottom:1em' }, [
					E('button', {
						'class': 'btn cbi-button',
						'click': function() {
							window.location.href = L.url('admin/control/ztc1control');
						}
					}, [ '← 返回设备控制' ])
				]),
				formNode
			]);
		});
	},

	render: function(data) {
		var view = this;

		if (settingsRequested())
			return this.renderSettings();

		hideDevicesFooter(true);

		this.status = data || {};
		this.root = E('div', { 'id': 'ztc1-devices' }, []);

		var toolbar = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1em' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': function() { return view.handleScan(); }
			}, [ '扫描设备' ]),
			' ',
			E('button', {
				'class': 'btn cbi-button',
				'click': function() { return view.refresh(true); }
			}, [ '刷新状态' ]),
			' ',
			E('button', {
				'class': 'btn cbi-button',
				'click': function() {
					window.location.href = L.url('admin/control/ztc1control') + '?settings=1';
				}
			}, [ '设置' ]),
			E('span', {
				'id': 'ztc1-service',
				'style': 'margin-left:1em;color:#777'
			}, [ serviceText(this.status) ])
		]);

		this.renderDevices();

		L.Poll.add(function() {
			return view.refresh(false);
		}, 5);

		return E('div', {}, [
			E('h2', {}, [ 'zTC1 智能排插' ]),
			toolbar,
			this.root
		]);
	},

	refresh: function(notifyUser) {
		var view = this;

		if (this.modalOpen)
			return Promise.resolve();

		return L.resolveDefault(callStatus(), {}).then(function(status) {
			view.status = status || {};
			view.renderDevices();

			var badge = document.getElementById('ztc1-service');

			if (badge)
				badge.textContent = serviceText(view.status);

			if (notifyUser === true)
				notify('状态已刷新');
		}).catch(function(err) {
			if (notifyUser === true)
				failure('刷新失败：' + ((err && err.message) || err));
		});
	},

	renderDevices: function() {
		var devices = (this.status.devices || []);
		var nodes = [];

		if (!devices.length) {
			nodes.push(E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [ '尚未发现设备。请确认排插与本机处于同一局域网，然后点击“扫描设备”。' ])
			]));
		}
		else {
			for (var i = 0; i < devices.length; i++)
				nodes.push(this.renderDevice(devices[i]));
		}

		var countdowns = this.renderCountdowns();

		if (countdowns)
			nodes.push(countdowns);

		while (this.root.firstChild)
			this.root.removeChild(this.root.firstChild);

		for (var j = 0; j < nodes.length; j++)
			this.root.appendChild(nodes[j]);
	},

	renderDevice: function(device) {
		var view = this;
		var name = device.name || device.device_name || ('zTC1 ' + String(device.mac).slice(-4).toUpperCase());
		var meta = [];

		if (device.mac)
			meta.push(device.mac);

		if (device.ip)
			meta.push(device.ip);

		if (device.version)
			meta.push(device.version);

		if (device.ssid)
			meta.push(device.ssid);

		var stateBadge = E('span', {
			'class': 'label',
			'style': device.online
				? 'background:#d9f2e6 !important;color:#176b48 !important;padding:2px 8px;border-radius:10px;font-size:12px'
				: 'background:#f2dede !important;color:#a94442 !important;padding:2px 8px;border-radius:10px;font-size:12px'
		}, [ device.online ? '在线' : '离线' ]);

		var lockBadge = E('span', {
			'class': 'label',
			'style': (device.lock_state === true)
				? 'background:#dbeafe !important;color:#1d4ed8 !important;padding:2px 8px;border-radius:10px;font-size:12px;margin-left:4px'
				: 'background:#fff4e5 !important;color:#b45309 !important;padding:2px 8px;border-radius:10px;font-size:12px;margin-left:4px'
		}, [ (device.lock_state === true) ? '已激活' : '未激活' ]);

		var rows = [];

		rows.push(E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th', 'style': 'width:5em;text-align:center;white-space:nowrap' }, [ '#' ]),
			E('th', { 'class': 'th', 'style': 'width:auto' }, [ '名称' ]),
			E('th', { 'class': 'th', 'style': 'width:7em;text-align:center;white-space:nowrap' }, [ '状态' ]),
			E('th', { 'class': 'th', 'style': 'width:7em;text-align:center;white-space:nowrap' }, [ '操作' ])
		]));

		for (var i = 0; i < 6; i++) {
			rows.push(this.renderPlugRow(device, (device.plugs && device.plugs[i]) || { index: i, on: -1 }, i));
		}

		var actions = E('div', { 'style': 'margin-top:.6em' }, [
			this.actionButton('刷新', function() { return view.handleQuery(device); }),
			this.actionButton('重命名', function() { return view.handleRename(device); }),
			this.actionButton('激活码', function() { return view.handleActivate(device); }),
			this.actionButton('童锁/夜间', function() { return view.handleLocks(device); }),
			this.actionButton('倒计时', function() { return view.handleCountdown(device); }),
			this.actionButton('定时任务', function() { return view.handleTimer(device); })
		]);

		return E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1.2em' }, [
			E('h3', {}, [ name, ' ', stateBadge, ' ', lockBadge ]),
			E('div', { 'class': 'cbi-section-descr' }, [
				meta.join(' · '),
				E('br', {}),
				'功率 ' + (device.power || '0') + ' W · 运行 ' + formatDuration(device.total_time)
			]),
			E('table', {
				'class': 'table',
				'style': 'table-layout:fixed;width:100%;max-width:52em'
			}, rows),
			actions
		]);
	},

	renderPlugRow: function(device, plug, index) {
		var view = this;
		var state = Number(plug.on);
		var isOn = (state === 1);
		var label = isOn ? '已开启' : (state === 0 ? '已关闭' : '未知');
		var buttonLabel = isOn ? '关闭' : '开启';
		var buttonClass = isOn ? 'cbi-button-reset' : 'cbi-button-apply';

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'text-align:center;white-space:nowrap' }, [ 'P' + (index + 1) ]),
			E('td', {
				'class': 'td',
				'style': 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
				'title': plug.name || ('插口 ' + (index + 1))
			}, [ plug.name || ('插口 ' + (index + 1)) ]),
			E('td', { 'class': 'td', 'style': 'text-align:center;white-space:nowrap' }, [ label ]),
			E('td', { 'class': 'td', 'style': 'text-align:center;white-space:nowrap' }, [
				E('button', {
					'class': 'btn cbi-button ' + buttonClass,
					'click': function() { return view.handleToggle(device, index, state); }
				}, [ buttonLabel ])
			])
		]);
	},

	actionButton: function(label, handler) {
		return E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'style': 'margin-right:.4em;margin-top:.2em',
			'click': handler
		}, [ label ]);
	},

	renderCountdowns: function() {
		var view = this;
		var jobs = (this.status.countdowns || []);

		if (!jobs.length)
			return null;

		var rows = [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ '设备' ]),
				E('th', { 'class': 'th' }, [ '插口' ]),
				E('th', { 'class': 'th' }, [ '动作' ]),
				E('th', { 'class': 'th' }, [ '剩余时间' ]),
				E('th', { 'class': 'th', 'style': 'width:5em' }, [ '操作' ])
			])
		];

		for (var i = 0; i < jobs.length; i++) {
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ this.deviceName(jobs[i].mac) ]),
				E('td', { 'class': 'td' }, [ '插口 ' + (Number(jobs[i].plug) + 1) ]),
				E('td', { 'class': 'td' }, [ Number(jobs[i].action) === 1 ? '开启' : '关闭' ]),
				E('td', { 'class': 'td' }, [ formatRemain(jobs[i].remain) ]),
				E('td', { 'class': 'td' }, [
					(function(job) {
						return E('button', {
							'class': 'btn cbi-button cbi-button-reset',
							'click': function() { return view.handleCancelCountdown(job); }
						}, [ '取消' ]);
					})(jobs[i])
				])
			]));
		}

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ '倒计时任务' ]),
			E('table', { 'class': 'table' }, rows)
		]);
	},

	deviceName: function(mac) {
		var devices = (this.status.devices || []);

		for (var i = 0; i < devices.length; i++) {
			if (devices[i].mac === mac) {
				return devices[i].name || devices[i].device_name ||
					('zTC1 ' + String(mac).slice(-4).toUpperCase());
			}
		}

		return mac;
	},

	openModal: function(title, body, handler) {
		var view = this;

		this.modalOpen = true;

		var close = function() {
			view.modalOpen = false;
			ui.hideModal();
		};

		ui.showModal(title, [
			E('div', {}, body),
			E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [
				E('button', { 'class': 'btn', 'click': close }, [ '取消' ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function() {
						Promise.resolve().then(function() {
							return handler();
						}).then(function() {
							close();
							return view.refresh(false);
						}).catch(function(err) {
							failure((err && err.message) || String(err));
						});
					}
				}, [ '应用' ])
			])
		]);
	},

	handleScan: function() {
		var view = this;

		return callScan().then(function(result) {
			ensureOk(result, '扫描失败');
			notify('已发送扫描广播，正在等待设备响应…');
			return delay(1500);
		}).then(function() {
			return view.refresh(false);
		}).catch(function(err) {
			failure('扫描失败：' + ((err && err.message) || err));
		});
	},

	handleQuery: function(device) {
		var view = this;

		return callQuery(device.mac).then(function(result) {
			ensureOk(result, '查询失败');
			notify('已发送状态查询');
			return delay(800);
		}).then(function() {
			return view.refresh(false);
		}).catch(function(err) {
			failure('查询失败：' + ((err && err.message) || err));
		});
	},

	handleToggle: function(device, index, state) {
		var view = this;
		var target = (state === 1) ? 0 : 1;

		return callPlug(device.mac, index, target).then(function(result) {
			ensureOk(result, '控制失败');
			notify('命令已发送，等待设备回报');
			return delay(900);
		}).then(function() {
			return view.refresh(false);
		}).catch(function(err) {
			failure('控制失败：' + ((err && err.message) || err));
		});
	},

	handleCancelCountdown: function(job) {
		return callCancelCountdown(job.id).then(function(result) {
			ensureOk(result, '取消失败');
			notify('倒计时已取消');
		}).catch(function(err) {
			failure('取消失败：' + ((err && err.message) || err));
		});
	},

	handleRename: function(device) {
		var nameInput = textInput(device.name || device.device_name || '');
		var plugInputs = [];
		var body = [
			E('p', { 'class': 'cbi-section-descr' }, [
				'名称会同时写入排插：设备名称最多 32 字节（约 10 个汉字），插口名称最多 16 个字符；留空则只保存在路由器本地。'
			]),
			field('设备名称', nameInput)
		];

		for (var i = 0; i < 6; i++) {
			var plug = (device.plugs && device.plugs[i]) || {};
			var input = textInput(plug.name || '');

			input.setAttribute('maxlength', '16');
			plugInputs.push(input);
			body.push(field('插口 ' + (i + 1) + ' 名称', input));
		}

		this.openModal('重命名设备', body, function() {
			var names = [];

			if (utf8Bytes(nameInput.value) > 32) {
				throw new Error('设备名称超过 32 字节，请缩短后再保存');
			}

			for (var j = 0; j < plugInputs.length; j++) {
				var value = plugInputs[j].value;

				if (utf8Chars(value) > 16) {
					throw new Error('插口 ' + (j + 1) + ' 的名称超过 16 个字符，请缩短后再保存');
				}

				names.push(value);
			}

			return callRename(device.mac, nameInput.value, names).then(function(result) {
				ensureOk(result, '保存失败');

				if (Number(result.sent) > 0)
					notify('名称已保存并发送到排插');
				else
					notify('名称已保存到本地，但发送到排插失败');

				/* Give the strip a moment to report the new names. */
				return delay(800);
			});
		});
	},

	handleActivate: function(device) {
		var codeInput = textInput('');
		var body = [ field('激活码', codeInput) ];

		this.openModal('填写设备激活码', body, function() {
			if (!codeInput.value) {
				throw new Error('请输入激活码');
			}

			return callActivate(device.mac, codeInput.value).then(function(result) {
				ensureOk(result, '发送失败');
				notify('激活码已发送，请查看设备状态');
			});
		});
	},

	handleLocks: function(device) {
		var childLock = E('input', { 'type': 'checkbox' });
		var ledLock = E('input', { 'type': 'checkbox' });

		childLock.checked = (Number(device.child_lock) === 1);
		ledLock.checked = (Number(device.led_lock) === 1);

		var body = [
			field('童锁（按键无效）', childLock),
			field('夜间模式（关闭 LED）', ledLock)
		];

		this.openModal('童锁与夜间模式', body, function() {
			return callLocks(device.mac, childLock.checked ? 1 : 0, ledLock.checked ? 1 : 0).then(function(result) {
				ensureOk(result, '设置失败');
				notify('设置已发送');
			});
		});
	},

	handleCountdown: function(device) {
		var plugSelect = selectBox(plugOptions(device), 0);
		var minutesInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '10080' });
		var actionSelect = selectBox([ [ 0, '关闭' ], [ 1, '开启' ] ], 0);

		minutesInput.value = '5';

		var body = [
			field('插口', plugSelect),
			field('倒计时（分钟）', minutesInput),
			field('到时动作', actionSelect)
		];

		this.openModal('倒计时开关', body, function() {
			var minutes = parseInt(minutesInput.value, 10);

			if (!(minutes >= 1 && minutes <= 10080)) {
				throw new Error('倒计时分钟数必须在 1 到 10080 之间');
			}

			return callCountdown(device.mac, parseInt(plugSelect.value, 10), minutes * 60, parseInt(actionSelect.value, 10)).then(function(result) {
				ensureOk(result, '设置失败');
				notify('倒计时已设置');
			});
		});
	},

	handleTimer: function(device) {
		var plugSelect = selectBox(plugOptions(device), 0);
		var taskSelect = selectBox([
			[ 0, '任务 1' ], [ 1, '任务 2' ], [ 2, '任务 3' ], [ 3, '任务 4' ], [ 4, '任务 5' ]
		], 0);
		var timeInput = E('input', { 'class': 'cbi-input-text', 'type': 'time' });
		var repeatSelect = selectBox([
			[ 127, '每天' ], [ 31, '周一至周五' ], [ 96, '周六、周日' ], [ 0, '仅一次' ]
		], 127);
		var actionSelect = selectBox([ [ 1, '开启' ], [ 0, '关闭' ] ], 1);
		var enableSelect = selectBox([ [ 1, '启用' ], [ 0, '停用' ] ], 1);

		timeInput.value = '08:00';

		var body = [
			field('插口', plugSelect),
			field('任务编号', taskSelect),
			field('时间', timeInput),
			field('重复', repeatSelect),
			field('动作', actionSelect),
			field('任务状态', enableSelect)
		];

		this.openModal('设备原生定时任务', body, function() {
			var parts = String(timeInput.value || '').split(':');
			var hour = parseInt(parts[0], 10);
			var minute = parseInt(parts[1], 10);

			if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) {
				throw new Error('请输入有效的时间');
			}

			return callTimer(device.mac,
				parseInt(plugSelect.value, 10),
				parseInt(taskSelect.value, 10),
				hour, minute,
				parseInt(repeatSelect.value, 10),
				parseInt(actionSelect.value, 10),
				parseInt(enableSelect.value, 10)).then(function(result) {
					ensureOk(result, '设置失败');
					notify('定时任务已发送到设备');
				});
		});
	}
});
