'use strict';

'require form';
'require view';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('ztc1control', 'zTC1 服务设置',
			'配置 zTC1 智能排插的局域网 UDP 服务。修改后点击“保存并应用”以重启服务。');

		s = m.section(form.NamedSection, 'main', 'ztc1control');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', '启用服务',
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

		return m.render();
	}
});
