#!/usr/bin/ucode
/*
 * zTC1 LAN helper daemon
 *
 * Listens on UDP/10181 for device reports, periodically broadcasts a
 * discovery request to UDP/10182, keeps a small state file for the LuCI
 * frontend and executes locally scheduled countdown jobs.
 *
 * The zTC1 protocol is documented at:
 * https://github.com/a2633063/zTC1/wiki/通信协议
 */

'use strict';

import * as fs from 'fs';
import * as uloop from 'uloop';
import * as socket from 'socket';

const STATE_DIR = ARGV[0] ?? '/var/run/ztc1';
const LISTEN_PORT = int(ARGV[1] ?? 10181);
const COMMAND_PORT = int(ARGV[2] ?? 10182);
const BROADCAST = ARGV[3] ?? '255.255.255.255';
const BIND_DEVICE = ARGV[4] ?? '';
const SCAN_INTERVAL = int(ARGV[5] ?? 60);

const STATE_FILE = STATE_DIR + '/state.json';
const COUNTDOWN_DIR = STATE_DIR + '/countdown';

let devices = {};
let sock = null;

function logmsg(msg) {
	printf('%s\n', msg);
}

function to_num(value) {
	if (type(value) == 'int')
		return value;

	if (type(value) == 'double')
		return int(value);

	if (type(value) == 'bool')
		return value ? 1 : 0;

	if (type(value) == 'string' && match(value, /^-?[0-9]+$/))
		return int(value);

	return null;
}

function norm_mac(value) {
	let str = lc(sprintf('%s', value ?? ''));
	let out = '';

	for (let i = 0; i < length(str); i++) {
		let ch = substr(str, i, 1);

		if (match(ch, /[0-9a-f]/))
			out += ch;
	}

	return out;
}

function new_device(mac) {
	return {
		mac: mac,
		device_name: '',
		type: null,
		type_name: '',
		ip: '',
		ssid: '',
		version: '',
		power: '',
		total_time: null,
		child_lock: 0,
		led_lock: 0,
		lock_state: false,
		last_seen: 0,
		plugs: []
	};
}

function new_plug(index) {
	return { index: index, name: '', on: null };
}

function ensure_plug(dev, index) {
	while (length(dev.plugs) <= index)
		push(dev.plugs, new_plug(length(dev.plugs)));

	return dev.plugs[index];
}

function ztc1_is_ipv4(value) {
	if (type(value) != 'string')
		return false;

	let parts = split(value, '.');

	if (length(parts) != 4)
		return false;

	for (let i = 0; i < 4; i++) {
		if (!match(parts[i], /^[0-9]+$/))
			return false;

		if (int(parts[i]) > 255)
			return false;
	}

	return true;
}

function update_device(msg, source_ip) {
	let mac = norm_mac(msg.mac);

	if (length(mac) != 12)
		return null;

	let dev = devices[mac];

	if (dev == null)
		dev = new_device(mac);

	if (type(msg.name) == 'string' && length(msg.name))
		dev.device_name = msg.name;

	if (to_num(msg.type) != null)
		dev.type = to_num(msg.type);

	if (type(msg.type_name) == 'string' && length(msg.type_name))
		dev.type_name = msg.type_name;

	if (type(msg.ip) == 'string' && ztc1_is_ipv4(msg.ip))
		dev.ip = msg.ip;
	else if (type(source_ip) == 'string' && ztc1_is_ipv4(source_ip))
		dev.ip = source_ip;

	if (type(msg.ssid) == 'string')
		dev.ssid = msg.ssid;

	if (type(msg.version) == 'string')
		dev.version = msg.version;

	if (msg.power != null)
		dev.power = sprintf('%s', msg.power);

	if (to_num(msg.total_time) != null)
		dev.total_time = to_num(msg.total_time);

	if (msg.child_lock != null)
		dev.child_lock = (to_num(msg.child_lock) == 1) ? 1 : 0;

	if (msg.led_lock != null)
		dev.led_lock = (to_num(msg.led_lock) == 1) ? 1 : 0;

	if (msg.lock === true || to_num(msg.lock) == 1)
		dev.lock_state = true;
	else if (msg.lock === false)
		dev.lock_state = false;

	for (let i = 0; i < 6; i++) {
		let src = msg['plug_' + i];

		if (type(src) != 'object')
			continue;

		let plug = ensure_plug(dev, i);

		if (src.on != null)
			plug.on = (to_num(src.on) == 1) ? 1 : 0;

		if (type(src.name) == 'string' && length(src.name))
			plug.name = src.name;

		if (type(src.setting) == 'object') {
			for (let t = 0; t < 5; t++) {
				let task = src.setting['task_' + t];

				if (type(task) == 'object')
					plug['task_' + t] = task;
			}
		}
	}

	dev.last_seen = time();
	devices[mac] = dev;

	return dev;
}

function device_ip(mac) {
	let dev = devices[mac];

	if (dev != null && length(dev.ip) && ztc1_is_ipv4(dev.ip))
		return dev.ip;

	return null;
}

function send_to(payload, address) {
	if (sock == null)
		return false;

	let rv = sock.send(sprintf('%J', payload), 0, {
		family: socket.AF_INET,
		address: address,
		port: COMMAND_PORT
	});

	if (rv == null) {
		logmsg(sprintf('failed to send to %s', address));
		return false;
	}

	return true;
}

function scan() {
	send_to({ cmd: 'device report' }, BROADCAST);
}

function save_state() {
	let now = time();
	let list = [];

	for (let mac in devices) {
		let dev = devices[mac];

		if (now - dev.last_seen > 7 * 86400)
			continue;

		push(list, dev);
	}

	let tmp = STATE_FILE + '.tmp';

	try {
		fs.writefile(tmp, sprintf('%J', { updated: now, devices: list }) + '\n');
		fs.rename(tmp, STATE_FILE);
	}
	catch (e) {
		logmsg(sprintf('failed to write state: %s', e));
	}
}

function load_state() {
	let raw = null;

	try {
		raw = fs.readfile(STATE_FILE);
	}
	catch (e) {
		return;
	}

	if (type(raw) != 'string' || !length(raw))
		return;

	let data = null;

	try {
		data = json(raw);
	}
	catch (e) {
		return;
	}

	if (type(data) != 'object' || type(data.devices) != 'array')
		return;

	let now = time();

	for (let i = 0; i < length(data.devices); i++) {
		let dev = data.devices[i];

		if (type(dev) != 'object')
			continue;

		let mac = norm_mac(dev.mac);

		if (length(mac) != 12)
			continue;

		if (now - (to_num(dev.last_seen) ?? 0) > 7 * 86400)
			continue;

		if (type(dev.plugs) != 'array')
			dev.plugs = [];

		dev.mac = mac;
		devices[mac] = dev;
	}
}

function handle_report(data, source_ip) {
	let msg = null;

	try {
		msg = json(data);
	}
	catch (e) {
		return;
	}

	if (type(msg) != 'object')
		return;

	let dev = update_device(msg, source_ip);

	if (dev == null)
		return;

	save_state();

	/* Discovery replies only carry identity, ask for the runtime state. */
	if (msg.type != null && msg.power == null) {
		let target = device_ip(dev.mac) ?? source_ip;
		let query = {
			mac: dev.mac,
			power: null,
			total_time: null,
			version: null,
			child_lock: null,
			led_lock: null
		};

		for (let i = 0; i < 6; i++)
			query['plug_' + i] = { on: null };

		send_to(query, target);
	}
}

function handle_readable() {
	while (true) {
		let addr = {};
		let data = sock.recv(4096, 0, addr);

		if (data == null)
			break;

		if (!length(data))
			continue;

		handle_report(data, addr.address);
	}
}

function process_countdowns() {
	let now = time();
	let files = fs.lsdir(COUNTDOWN_DIR) ?? [];

	for (let i = 0; i < length(files); i++) {
		let name = files[i];
		let path = COUNTDOWN_DIR + '/' + name;

		if (!match(name, /\.json$/)) {
			fs.unlink(path);
			continue;
		}

		let parts = split(name, '-');
		let due = (length(parts) && match(parts[0], /^[0-9]+$/)) ? int(parts[0]) : null;

		if (due == null) {
			fs.unlink(path);
			continue;
		}

		if (due > now)
			continue;

		/* Drop jobs that could not be executed in a reasonable time. */
		if (due + 300 < now) {
			fs.unlink(path);
			continue;
		}

		let job = null;

		try {
			job = json(fs.readfile(path));
		}
		catch (e) {
			job = null;
		}

		if (type(job) == 'object') {
			let mac = norm_mac(job.mac);
			let plug = to_num(job.plug);
			let action = to_num(job.action);

			if (length(mac) == 12 && plug != null && plug >= 0 && plug <= 5) {
				let payload = { mac: mac };

				payload['plug_' + plug] = { on: (action == 1) ? 1 : 0 };

				let target = device_ip(mac) ?? BROADCAST;

				if (!send_to(payload, target))
					logmsg(sprintf('countdown send failed for %s', mac));
			}
		}

		fs.unlink(path);
	}
}

function start() {
	if (!fs.access(STATE_DIR))
		fs.mkdir(STATE_DIR, 0x1ed);

	if (!fs.access(COUNTDOWN_DIR))
		fs.mkdir(COUNTDOWN_DIR, 0x1ed);

	load_state();

	uloop.init();

	sock = socket.create(socket.AF_INET, socket.SOCK_DGRAM);

	if (sock == null)
		die('unable to create UDP socket');

	sock.setopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, true);
	sock.setopt(socket.SOL_SOCKET, socket.SO_BROADCAST, true);

	if (length(BIND_DEVICE)) {
		if (!sock.setopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, BIND_DEVICE))
			logmsg(sprintf('warning: unable to bind to device %s', BIND_DEVICE));
	}

	if (!sock.bind('0.0.0.0', LISTEN_PORT))
		die(sprintf('unable to bind UDP port %d', LISTEN_PORT));

	uloop.handle(sock, handle_readable, uloop.ULOOP_READ);

	let last_scan = 0;
	let housekeeping = null;
	let countdowns = null;

	housekeeping = uloop.timer(0, function() {
		let now = time();

		if (SCAN_INTERVAL > 0 && (last_scan == 0 || now - last_scan >= SCAN_INTERVAL)) {
			last_scan = now;
			scan();
		}

		save_state();
		housekeeping.set(30000);
	});

	countdowns = uloop.timer(5000, function() {
		process_countdowns();
		countdowns.set(5000);
	});

	save_state();
	logmsg(sprintf('listening on UDP/%d, commands on UDP/%d, broadcast %s, scan %ds',
		LISTEN_PORT, COMMAND_PORT, BROADCAST, SCAN_INTERVAL));

	uloop.run();
}

start();
