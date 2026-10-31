#!/usr/bin/ucode
/*
 * zTC1 command line helper used by the LuCI rpcd backend.
 *
 * Prints a single line of JSON on stdout and exits with 0 on success or 1
 * on failure. Configuration is passed in via the environment by the
 * /usr/bin/ztc1ctl shell wrapper.
 */

'use strict';

import * as fs from 'fs';
import * as socket from 'socket';

const COMMAND_PORT = int(getenv('ZTC1_COMMAND_PORT') ?? 10182);
const CONFIGURED_BROADCAST = getenv('ZTC1_BROADCAST') ?? '255.255.255.255';
const STATE_FILE = getenv('ZTC1_STATE_FILE') ?? '/var/run/ztc1/state.json';
const COUNTDOWN_DIR = getenv('ZTC1_COUNTDOWN_DIR') ?? '/var/run/ztc1/countdown';
const PROCESS_ID = getenv('ZTC1_PID') ?? '0';

function emit(obj) {
	printf('%s\n', sprintf('%J', obj));
}

function fail(message) {
	emit({ ok: false, error: message });
	exit(1);
}

function is_ipv4(value) {
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

function utf8_chars(value) {
	let str = sprintf('%s', value ?? '');
	let count = 0;

	for (let i = 0; i < length(str); i++)
		if ((ord(str, i) & 0xc0) != 0x80)
			count++;

	return count;
}

function state_device_name(mac) {
	let raw = null;
	let state = null;

	try {
		raw = fs.readfile(STATE_FILE);
	}
	catch (e) {
		raw = null;
	}

	if (type(raw) == 'string' && length(raw)) {
		try {
			state = json(raw);
		}
		catch (e) {
			state = null;
		}
	}

	if (type(state) == 'object' && type(state.devices) == 'array') {
		for (let i = 0; i < length(state.devices); i++) {
			let dev = state.devices[i];

			if (type(dev) == 'object' && dev.mac == mac && type(dev.device_name) == 'string')
				return dev.device_name;
		}
	}

	return '';
}

function valid_mac(value) {
	let str = lc(sprintf('%s', value ?? ''));
	let out = '';

	for (let i = 0; i < length(str); i++) {
		let ch = substr(str, i, 1);

		if (match(ch, /[0-9a-f]/))
			out += ch;
	}

	return (length(out) == 12) ? out : null;
}

function parse_int(value, minimum, maximum) {
	if (type(value) != 'string' || !match(value, /^-?[0-9]+$/))
		return null;

	let number = int(value);

	if (number < minimum || number > maximum)
		return null;

	return number;
}

function parse_switch(value) {
	switch (value) {
	case '1':
	case 'on':
	case 'true':
		return 1;

	case '0':
	case 'off':
	case 'false':
		return 0;
	}

	return null;
}

function broadcast_address() {
	return is_ipv4(CONFIGURED_BROADCAST) ? CONFIGURED_BROADCAST : '255.255.255.255';
}

function target_for(mac) {
	let raw = null;
	let state = null;

	try {
		raw = fs.readfile(STATE_FILE);
	}
	catch (e) {
		raw = null;
	}

	if (type(raw) == 'string' && length(raw)) {
		try {
			state = json(raw);
		}
		catch (e) {
			state = null;
		}
	}

	if (type(state) == 'object' && type(state.devices) == 'array') {
		for (let i = 0; i < length(state.devices); i++) {
			let dev = state.devices[i];

			if (type(dev) == 'object' && dev.mac == mac && is_ipv4(dev.ip))
				return dev.ip;
		}
	}

	return broadcast_address();
}

function send_packet(payload, address) {
	let sock = socket.create(socket.AF_INET, socket.SOCK_DGRAM);

	if (sock == null)
		return false;

	sock.setopt(socket.SOL_SOCKET, socket.SO_BROADCAST, true);

	let sent = sock.send(sprintf('%J', payload), 0, {
		family: socket.AF_INET,
		address: address,
		port: COMMAND_PORT
	});

	sock.close();

	return sent != null;
}

function send_command(payload, mac) {
	let address = target_for(mac);

	if (!send_packet(payload, address)) {
		emit({ ok: false, error: sprintf('unable to send command to %s', address) });
		exit(1);
	}

	return address;
}

function require_mac(value) {
	let mac = valid_mac(value);

	if (mac == null) {
		emit({ ok: false, error: 'invalid MAC address' });
		exit(1);
	}

	return mac;
}

function require_int(value, minimum, maximum, label) {
	let number = parse_int(value, minimum, maximum);

	if (number == null) {
		emit({ ok: false, error: sprintf('invalid %s', label) });
		exit(1);
	}

	return number;
}

function schedule_countdown(mac, plug, seconds, action) {
	let due = time() + seconds;
	let i = 0;

	if (!fs.access(COUNTDOWN_DIR))
		fs.mkdir(COUNTDOWN_DIR, 0x1ed);

	let base = COUNTDOWN_DIR + '/' + due + '-' + time() + '-' + PROCESS_ID;
	let path = base + '.json';

	while (fs.access(path)) {
		i++;
		path = base + '-' + i + '.json';
	}

	let tmp = path + '.tmp';
	let job = { mac: mac, plug: plug, action: action, due: due, created: time() };

	if (fs.writefile(tmp, sprintf('%J', job) + '\n') == null) {
		emit({ ok: false, error: 'unable to store countdown job' });
		exit(1);
	}

	if (!fs.rename(tmp, path)) {
		fs.unlink(tmp);
		emit({ ok: false, error: 'unable to store countdown job' });
		exit(1);
	}

	let parts = split(path, '/');

	return { id: parts[length(parts) - 1], due: due };
}

let action = ARGV[0];
let args = ARGV;
let mac;

if (action == 'scan') {
	let address = broadcast_address();

	if (!send_packet({ cmd: 'device report' }, address)) {
		emit({ ok: false, error: 'unable to send discovery broadcast' });
		exit(1);
	}

	emit({ ok: true, broadcast: address });
	exit(0);
}

if (action == 'plug') {
	mac = require_mac(args[1]);

	let plug = require_int(args[2], 0, 5, 'plug index');
	let on = parse_switch(args[3]);

	if (on == null) {
		emit({ ok: false, error: 'invalid plug state' });
		exit(1);
	}

	let payload = { mac: mac };

	payload['plug_' + plug] = { on: on };

	let address = send_command(payload, mac);

	emit({ ok: true, address: address });
	exit(0);
}

if (action == 'query') {
	mac = require_mac(args[1]);

	let payload = {
		mac: mac,
		power: null,
		total_time: null,
		version: null,
		child_lock: null,
		led_lock: null,
		lock: null
	};

	for (let i = 0; i < 6; i++)
		payload['plug_' + i] = { on: null, setting: { name: null } };

	let address = send_command(payload, mac);

	emit({ ok: true, address: address });
	exit(0);
}

if (action == 'locks') {
	mac = require_mac(args[1]);

	let child_lock = require_int(args[2], 0, 1, 'child lock state');
	let led_lock = require_int(args[3], 0, 1, 'LED lock state');

	let address = send_command({
		mac: mac,
		child_lock: child_lock,
		led_lock: led_lock
	}, mac);

	emit({ ok: true, address: address });
	exit(0);
}

if (action == 'activate') {
	mac = require_mac(args[1]);

	let code = sprintf('%s', args[2] ?? '');

	if (!length(code) || length(code) > 64) {
		emit({ ok: false, error: 'invalid activation code' });
		exit(1);
	}

	let address = send_command({ mac: mac, lock: code }, mac);

	emit({ ok: true, address: address });
	exit(0);
}

if (action == 'rename') {
	mac = require_mac(args[1]);

	let device_name = sprintf('%s', args[2] ?? '');
	let plug_names = [];
	let sent = 0;

	if (length(device_name) > 32) {
		emit({ ok: false, error: 'device name exceeds 32 bytes' });
		exit(1);
	}

	for (let i = 0; i < 6; i++) {
		let plug_name = sprintf('%s', args[3 + i] ?? '');

		if (length(plug_name) && utf8_chars(plug_name) > 16) {
			emit({ ok: false, error: 'plug name exceeds 16 characters' });
			exit(1);
		}

		push(plug_names, plug_name);
	}

	/* Effective device name: the new one when set, otherwise the last known one. */
	let current_name = length(device_name) ? device_name : state_device_name(mac);

	if (length(device_name)) {
		let address = send_command({ mac: mac, setting: { name: device_name } }, mac);

		sent++;
	}

	for (let i = 0; i < 6; i++) {
		if (!length(plug_names[i]))
			continue;

		let payload = { mac: mac };

		if (length(current_name))
			payload.name = current_name;

		payload['plug_' + i] = { setting: { name: plug_names[i] } };

		send_command(payload, mac);
		sent++;
	}

	emit({ ok: true, sent: sent });
	exit(0);
}

if (action == 'timer') {
	mac = require_mac(args[1]);

	let plug = require_int(args[2], 0, 5, 'plug index');
	let task = require_int(args[3], 0, 4, 'task index');
	let hour = require_int(args[4], 0, 23, 'hour');
	let minute = require_int(args[5], 0, 59, 'minute');
	let repeat = require_int(args[6], 0, 127, 'weekday mask');
	let timer_action = require_int(args[7], 0, 1, 'timer action');
	let enable = require_int(args[8], 0, 1, 'timer state');

	let payload = { mac: mac };
	let setting = {};

	setting['task_' + task] = {
		hour: hour,
		minute: minute,
		repeat: repeat,
		action: timer_action,
		on: enable
	};

	payload['plug_' + plug] = { setting: setting };

	let address = send_command(payload, mac);

	emit({ ok: true, address: address });
	exit(0);
}

if (action == 'countdown') {
	mac = require_mac(args[1]);

	let plug = require_int(args[2], 0, 5, 'plug index');
	let seconds = require_int(args[3], 1, 604800, 'countdown duration');
	let countdown_action = require_int(args[4], 0, 1, 'countdown action');

	let job = schedule_countdown(mac, plug, seconds, countdown_action);

	emit({ ok: true, id: job.id, due: job.due });
	exit(0);
}

emit({ ok: false, error: 'unknown action' });
exit(1);
