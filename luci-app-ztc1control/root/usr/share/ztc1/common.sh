#!/bin/sh
# Shared helpers for luci-app-ztc1control.

. /lib/functions.sh 2>/dev/null

ZTC1_STATE_DIR="${ZTC1_STATE_DIR:-/var/run/ztc1}"
ZTC1_STATE_FILE="$ZTC1_STATE_DIR/state.json"
ZTC1_COUNTDOWN_DIR="$ZTC1_STATE_DIR/countdown"

ZTC1_ENABLED=1
ZTC1_LISTEN_PORT=10181
ZTC1_COMMAND_PORT=10182
ZTC1_BROADCAST=auto
ZTC1_BIND_IFACE=auto
ZTC1_SCAN_INTERVAL=60
ZTC1_API_ENABLED=0
ZTC1_API_PORT=8091
ZTC1_API_KEY=""

ztc1_is_port() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	[ "$1" -ge 1 ] && [ "$1" -le 65535 ] 2>/dev/null
}

ztc1_is_uint() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	return 0
}

ztc1_is_ipv4() {
	local old_ifs octet

	case "$1" in
		''|*[!0-9.]*) return 1 ;;
	esac

	old_ifs="$IFS"
	IFS=.
	# shellcheck disable=SC2086
	set -- $1
	IFS="$old_ifs"

	[ "$#" -eq 4 ] || return 1

	for octet in "$1" "$2" "$3" "$4"; do
		ztc1_is_uint "$octet" || return 1
		[ "$octet" -le 255 ] || return 1
	done

	return 0
}

ztc1_calc_broadcast() {
	local old_ifs cidr="$1" ip prefix a b c d ipnum mask net bc

	ip="${cidr%%/*}"
	prefix="${cidr##*/}"
	[ "$prefix" != "$cidr" ] || return 1
	ztc1_is_uint "$prefix" || return 1
	[ "$prefix" -ge 1 ] && [ "$prefix" -le 32 ] || return 1

	old_ifs="$IFS"
	IFS=.
	# shellcheck disable=SC2086
	set -- $ip
	IFS="$old_ifs"
	[ "$#" -eq 4 ] || return 1

	a="$1"; b="$2"; c="$3"; d="$4"
	for ipnum in "$a" "$b" "$c" "$d"; do
		ztc1_is_uint "$ipnum" || return 1
		[ "$ipnum" -le 255 ] || return 1
	done

	ipnum=$(( (a << 24) | (b << 16) | (c << 8) | d ))
	mask=$(( (0xffffffff << (32 - prefix)) & 0xffffffff ))
	net=$(( ipnum & mask ))
	bc=$(( net | (~mask & 0xffffffff) ))

	printf '%d.%d.%d.%d\n' \
		$(( (bc >> 24) & 255 )) $(( (bc >> 16) & 255 )) \
		$(( (bc >> 8) & 255 )) $(( bc & 255 ))
}

ztc1_lan_subnet() {
	local subnet=""

	if [ -r /lib/functions/network.sh ]; then
		. /lib/functions/network.sh
		network_get_subnet subnet lan 2>/dev/null || subnet=""
	fi

	printf '%s\n' "$subnet"
}

# Resolve the configured broadcast option to an IPv4 broadcast address.
ztc1_resolve_broadcast() {
	local configured="$1" subnet

	case "$configured" in
		''|auto)
			subnet="$(ztc1_lan_subnet)"
			if [ -n "$subnet" ] && ztc1_calc_broadcast "$subnet"; then
				return 0
			fi
			printf '255.255.255.255\n'
			return 0
			;;
	esac

	if ztc1_is_ipv4 "$configured"; then
		printf '%s\n' "$configured"
		return 0
	fi

	printf '255.255.255.255\n'
}

ztc1_resolve_interface() {
	local configured="$1" dev=""

	case "$configured" in
		''|auto)
			if [ -r /lib/functions/network.sh ]; then
				. /lib/functions/network.sh
				network_get_device dev lan 2>/dev/null || dev=""
			fi
			[ -n "$dev" ] || dev="$(uci -q get network.lan.device 2>/dev/null)"
			;;
		none)
			dev=""
			;;
		*)
			dev="$configured"
			;;
	esac

	case "$dev" in
		*[!A-Za-z0-9_.:-]*) dev="" ;;
	esac

	printf '%s\n' "$dev"
}

ztc1_load_config() {
	config_load ztc1control 2>/dev/null || return 0

	config_get_bool ZTC1_ENABLED main enabled 1
	config_get ZTC1_LISTEN_PORT main listen_port 10181
	config_get ZTC1_COMMAND_PORT main command_port 10182
	config_get ZTC1_BROADCAST main broadcast auto
	config_get ZTC1_BIND_IFACE main bind_interface auto
	config_get ZTC1_SCAN_INTERVAL main scan_interval 60
	config_get_bool ZTC1_API_ENABLED main api_enabled 0
	config_get ZTC1_API_PORT main api_port 8091
	config_get ZTC1_API_KEY main api_key ''

	ztc1_is_port "$ZTC1_LISTEN_PORT" || ZTC1_LISTEN_PORT=10181
	ztc1_is_port "$ZTC1_COMMAND_PORT" || ZTC1_COMMAND_PORT=10182
	ztc1_is_port "$ZTC1_API_PORT" || ZTC1_API_PORT=8091
	ztc1_is_uint "$ZTC1_SCAN_INTERVAL" || ZTC1_SCAN_INTERVAL=60
	[ "$ZTC1_SCAN_INTERVAL" -le 86400 ] || ZTC1_SCAN_INTERVAL=60
}
