#!/bin/sh
#
# netmon-daemon.sh - luci-app-netmonitor 后台检测守护进程
#
# 由 /etc/init.d/netmonitor 通过 procd 拉起，全局唯一实例。
# 浏览器页面只读取本进程产出的数据，不会创建第二套探测任务。
#
# 设计要点
#   1. 高频数据全部写入 /tmp（tmpfs），默认不写 Flash；只有显式开启持久化时，
#      才会按 persist_interval 把「聚合桶」批量落盘。
#   2. 统计信息采用「分段（chunk）+ 直方图」增量维护：每轮只做 O(1) 更新，
#      避免每次检测都全量重算历史，CPU 占用与历史长度无关。
#   3. 严格校验用户输入，ping 目标始终以引号包裹且禁止以 '-' 开头，杜绝命令注入。
#   4. 任何异常都被收敛为明确的错误码（超时 / DNS / 不可达 / 其它），不笼统报「网络异常」。
#
# 运行期文件（全部位于 /tmp/netmonitor）
#   targets.tsv            本轮生效的目标清单（配置重载时重建）
#   tick                   心跳时间戳，前端据此判断后台是否真的在跑
#   state/<id>             目标运行时状态（上次检测时间、连续失败次数…）
#   ring/<id>.tsv          原始采样点环形缓存（t, latency, ok, errno）
#   hist/<id>.cur          当前统计段
#   hist/<id>.seg          已完成的统计段
#   tmp/<id>.res           单次检测的中间结果
#
# 持久化文件（/etc/netmonitor/history，需显式开启）
#   <id>.agg               聚合桶（t, avg, min, max, ok, cnt, loss）
#   <id>.last              上次落盘时间戳
#

. /lib/functions.sh

RUN_DIR=/tmp/netmonitor
RING_DIR=$RUN_DIR/ring
HIST_DIR=$RUN_DIR/hist
STATE_DIR=$RUN_DIR/state
TMP_DIR=$RUN_DIR/tmp
PERSIST_DIR=/etc/netmonitor/history
TAG=netmonitor

# 每个统计段包含的采样点数（段满后固化为一行，便于裁剪与快速聚合）
CHUNK=60
# 直方图桶上界（毫秒），共 17 个桶，用于估算 P50/P95/P99
BUCKETS="1 5 10 20 30 40 50 75 100 150 200 300 400 500 750 1000"
NB=17

TAB=$(printf '\t')

# 错误码：0 成功 / 1 超时 / 2 DNS 解析失败 / 3 网络不可达 / 4 其它错误 / 5 非法目标
E_OK=0
E_TIMEOUT=1
E_DNS=2
E_UNREACH=3
E_OTHER=4
E_INVALID=5

RELOAD=1
STOP=0

# ---------------------------------------------------------------- 全局配置
G_ENABLED=1
G_INTERVAL=10
G_TIMEOUT=3
G_COUNT=1
G_CONCURRENCY=5
G_FAMILY=auto
G_IFACE=
G_SOURCE=
G_PERSISTENCE=0
G_HISTORY=24h
G_PERSIST_INTERVAL=300
G_MAX_POINTS=4320
G_LOG_LEVEL=info
G_FAIL_WARN=3
G_FAIL_CRITICAL=5

# ---------------------------------------------------------------- 工具函数
log_msg() {
	# log_msg <level> <message>
	case "$1" in
		debug)
			[ "$G_LOG_LEVEL" = "debug" ] || return 0
			;;
		info)
			case "$G_LOG_LEVEL" in debug|info) ;; *) return 0 ;; esac
			;;
	esac
	logger -t "$TAG" -p "$1" "$2"
}

# 数值合法性：非负整数
is_uint() {
	case "${1:-}" in
		''|*[!0-9]*) return 1 ;;
	esac
	return 0
}

# 目标地址合法性：域名 / IPv4 / IPv6（含 IPv6 文本与 zone id）
# 禁止空值、禁止以 '-' 开头（避免被 ping 当作选项），长度上限 253
valid_host() {
	local h="$1"
	[ -n "$h" ] || return 1
	[ "${#h}" -le 253 ] || return 1
	case "$h" in
		-*) return 1 ;;
		*[!A-Za-z0-9._:\[\]%-]*) return 1 ;;
	esac
	return 0
}

# 接口 / 源地址合法性
valid_iface() {
	local v="$1"
	[ -z "$v" ] && return 0
	[ "${#v}" -le 64 ] || return 1
	case "$v" in
		-*) return 1 ;;
		*[!A-Za-z0-9._:@%-]*) return 1 ;;
	esac
	return 0
}

clamp() {
	# clamp <value> <min> <max>
	local v="$1" mn="$2" mx="$3"
	is_uint "$v" || v="$mn"
	[ "$v" -lt "$mn" ] && v="$mn"
	[ "$v" -gt "$mx" ] && v="$mx"
	printf '%s' "$v"
}

retention_seconds() {
	case "$1" in
		1h)   printf '3600' ;;
		6h)   printf '21600' ;;
		12h)  printf '43200' ;;
		24h)  printf '86400' ;;
		3d)   printf '259200' ;;
		7d)   printf '604800' ;;
		30d)  printf '2592000' ;;
		*)    printf '86400' ;;
	esac
}

setup_dirs() {
	mkdir -p "$RUN_DIR" "$RING_DIR" "$HIST_DIR" "$STATE_DIR" "$TMP_DIR"
	if [ "$G_PERSISTENCE" = "1" ]; then
		mkdir -p "$PERSIST_DIR"
	fi
	rm -f "$TMP_DIR"/* 2>/dev/null
}

zeros_hist() {
	# 输出 NB 个 0，空格分隔
	local i=0 out=
	while [ $i -lt $NB ]; do
		out="$out${out:+ }0"
		i=$((i + 1))
	done
	printf '%s' "$out"
}

# ---------------------------------------------------------------- 配置加载
load_config() {
	# 目标清单写入依赖 $RUN_DIR 存在，这里兜底创建（对 tmpfs 而言开销可忽略）
	mkdir -p "$RUN_DIR"

	config_load netmonitor

	config_get_bool G_ENABLED global enabled 1
	config_get G_INTERVAL global interval 10
	config_get G_TIMEOUT global timeout 3
	config_get G_COUNT global count 1
	config_get G_CONCURRENCY global concurrency 5
	config_get G_FAMILY global address_family auto
	config_get G_IFACE global interface ''
	config_get G_SOURCE global source ''
	config_get_bool G_PERSISTENCE global persistence 0
	config_get G_HISTORY global history 24h
	config_get G_PERSIST_INTERVAL global persist_interval 300
	config_get G_MAX_POINTS global max_points 4320
	config_get G_LOG_LEVEL global log_level info
	config_get G_FAIL_WARN global fail_warn 3
	config_get G_FAIL_CRITICAL global fail_critical 5

	G_INTERVAL=$(clamp "$G_INTERVAL" 1 3600)
	G_TIMEOUT=$(clamp "$G_TIMEOUT" 1 30)
	G_COUNT=$(clamp "$G_COUNT" 1 20)
	G_CONCURRENCY=$(clamp "$G_CONCURRENCY" 1 50)
	G_PERSIST_INTERVAL=$(clamp "$G_PERSIST_INTERVAL" 60 3600)
	G_MAX_POINTS=$(clamp "$G_MAX_POINTS" 60 200000)
	G_FAIL_WARN=$(clamp "$G_FAIL_WARN" 1 100)
	G_FAIL_CRITICAL=$(clamp "$G_FAIL_CRITICAL" 1 1000)

	valid_iface "$G_IFACE" || G_IFACE=''
	valid_iface "$G_SOURCE" || G_SOURCE=''

	# 目标清单 -> targets.tsv
	: > "$RUN_DIR/targets.tsv"
	config_foreach nm_append_target target
}

nm_append_target() {
	local sid="$1"
	local name host region proto family interval timeout iface source label enabled remark

	config_get name "$sid" name "$sid"
	config_get host "$sid" host ''
	config_get region "$sid" region other
	config_get proto "$sid" proto icmp
	config_get family "$sid" family auto
	config_get interval "$sid" interval 0
	config_get timeout "$sid" timeout 0
	config_get iface "$sid" interface ''
	config_get source "$sid" source ''
	config_get label "$sid" label ''
	config_get remark "$sid" remark ''
	config_get_bool enabled "$sid" enabled 1

	[ "$enabled" = "1" ] || return 0
	valid_host "$host" || {
		log_msg warning "target '$name' skipped: invalid host '$host'"
		return 0
	}
	valid_iface "$iface" || iface=''
	valid_iface "$source" || source=''

	# 空字段必须写成占位符 '-'：TAB 是 IFS 空白字符，read 会合并连续
	# 分隔符，导致后面的字段整体左移（label 被当成 iface 传进 ping -I）。
	[ -n "$name" ] || name='-'
	[ -n "$iface" ] || iface='-'
	[ -n "$source" ] || source='-'
	[ -n "$label" ] || label='-'
	[ -n "$remark" ] || remark='-'

	case "$region" in
		cn|overseas|other) ;;
		*) region=other ;;
	esac
	case "$family" in
		auto|ipv4|ipv6|both) ;;
		*) family=auto ;;
	esac
	is_uint "$interval" || interval=0
	is_uint "$timeout" || timeout=0

	printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
		"$sid" "$name" "$host" "$region" "$proto" "$timeout" "$interval" \
		"$family" "$iface" "$source" "$label" "$remark" >> "$RUN_DIR/targets.tsv"
}

# 目标实际使用的检测间隔（0 表示跟随全局）
target_interval() {
	local iv="$1"
	is_uint "$iv" || iv=0
	[ "$iv" -lt 1 ] && iv=$G_INTERVAL
	[ "$iv" -lt "$G_INTERVAL" ] && iv=$G_INTERVAL
	printf '%s' "$iv"
}

target_timeout() {
	local tv="$1"
	is_uint "$tv" || tv=0
	[ "$tv" -lt 1 ] && tv=$G_TIMEOUT
	printf '%s' "$tv"
}

# ---------------------------------------------------------------- 单次检测
run_check() {
	# run_check <id> <host> <timeout> <family> <iface> <source>
	local id="$1" host="$2" timeout="$3" family="$4" iface="$5" source="$6"
	local out="$TMP_DIR/$id.out"
	local res="$TMP_DIR/$id.res"
	local cmd=ping
	local deadline rc parsed lat ok eno sent recv

	: > "$out"

	if ! valid_host "$host"; then
		printf '%s\t%s\t%s\t%s\t%s\n' '-' '0' "$E_INVALID" "$G_COUNT" '0' > "$res"
		return 0
	fi

	case "$family" in
		ipv6) command -v ping6 >/dev/null 2>&1 && cmd=ping6 ;;
	esac

	deadline=$((timeout * G_COUNT + 2))

	# 注意：参数通过 "$@" 传递，host 单独加引号，且已校验不以 '-' 开头
	if [ -n "$iface" ]; then
		"$cmd" -c "$G_COUNT" -W "$timeout" -w "$deadline" -I "$iface" "$host" > "$out" 2>&1
	elif [ -n "$source" ]; then
		"$cmd" -c "$G_COUNT" -W "$timeout" -w "$deadline" -I "$source" "$host" > "$out" 2>&1
	else
		"$cmd" -c "$G_COUNT" -W "$timeout" -w "$deadline" "$host" > "$out" 2>&1
	fi
	rc=$?

	parsed=$(awk -v cnt="$G_COUNT" '
		BEGIN { lat = ""; ok = 0; eno = 4; ploss = -1; sent = cnt + 0; }
		/time=/ {
			tmp = $0;
			sub(/^.*time[=<]/, "", tmp);
			sub(/[^0-9.].*$/, "", tmp);
			if (tmp != "" && lat == "") lat = tmp;
		}
		/[0-9]+% packet loss/ {
			tmp = $0;
			if (match(tmp, /[0-9]+(\.[0-9]+)?% packet loss/)) {
				seg = substr(tmp, RSTART, RLENGTH);
				sub(/%.*$/, "", seg);
				ploss = seg + 0;
			}
		}
		/100% packet loss|no answer|timed out|Request timeout|Timeout/ { eno = 1 }
		/Network is unreachable|Network unreachable|No route to host|no route to host|Network is down/ { eno = 3 }
		/bad address|unknown host|not known|Name or service|cannot resolve|failure in name resolution|nodename nor servname|Could not resolve|not found/ { eno = 2 }
		END {
			if (lat != "") ok = 1;
			if (ploss >= 0) recv = int(sent * (100 - ploss) / 100 + 0.5); else recv = (ok ? sent : 0);
			if (ok) { eno = 0; }
			else if (eno == 4 && ploss >= 100) { eno = 1; }
			printf "%s\t%d\t%d\t%d\t%d\n", (ok ? lat : "-"), ok, eno, sent, recv;
		}
	' "$out")

	lat=$(printf '%s' "$parsed" | cut -f1)
	ok=$(printf '%s' "$parsed" | cut -f2)
	eno=$(printf '%s' "$parsed" | cut -f3)
	sent=$(printf '%s' "$parsed" | cut -f4)
	recv=$(printf '%s' "$parsed" | cut -f5)

	# 多包时优先使用 ping 自身给出的平均 RTT
	if [ "$ok" = "1" ] && [ "$G_COUNT" -gt 1 ]; then
		local avg
		avg=$(sed -n 's#.*min/avg/max[^=]*= *[0-9.]*/\([0-9.]*\)/.*#\1#p' "$out" | tail -n 1)
		case "$avg" in
			''|*[!0-9.]*) ;;
			*) lat="$avg" ;;
		esac
	fi

	printf '%s\t%s\t%s\t%s\t%s\n' "$lat" "$ok" "$eno" "$sent" "$recv" > "$res"
	rm -f "$out"
	return 0
}

# ---------------------------------------------------------------- 统计段维护
update_stats() {
	# update_stats <id> <ts> <lat|-> <ok> <sent> <recv>
	local id="$1" ts="$2" lat="$3" ok="$4" sent="$5" recv="$6"
	local curf="$HIST_DIR/$id.cur"
	local segf="$HIST_DIR/$id.seg"
	local tmpf="$HIST_DIR/$id.tmp"
	local segs_max=$((G_MAX_POINTS / CHUNK + 2))
	local c

	awk -v CUR="$curf" -v SEG="$segf" -v ts="$ts" -v lat="$lat" -v ok="$ok" \
		-v sc="$sent" -v rc="$recv" -v chunk="$CHUNK" -v edges="$BUCKETS" '
		BEGIN {
			nb = split(edges, E, " ");
			for (i = 0; i <= nb; i++) h[i] = 0;
			t0 = ts; sum = 0; cnt = 0; okc = 0; mn = "-"; mx = "-"; sent = 0; recv = 0;
			while ((getline line < CUR) > 0) {
				if (line == "") continue;
				n = split(line, F, "\t");
				if (n < 9) continue;
				t0 = F[1]; sum = F[2] + 0; cnt = F[3] + 0; okc = F[4] + 0;
				mn = F[5]; mx = F[6]; sent = F[7] + 0; recv = F[8] + 0;
				m = split(F[9], HH, " ");
				for (i = 1; i <= m; i++) h[i - 1] = HH[i] + 0;
			}
			close(CUR);
			cnt++;
			sent += sc + 0;
			recv += rc + 0;
			if (ok + 0 == 1) {
				v = lat + 0;
				okc++;
				sum += v;
				if (mn == "-" || mn == "") mn = lat; else if (v < mn + 0) mn = lat;
				if (mx == "-" || mx == "") mx = lat; else if (v > mx + 0) mx = lat;
				b = nb;
				for (i = 0; i < nb; i++) { if (v < E[i + 1] + 0) { b = i; break; } }
				h[b]++;
			}
			out = sprintf("%d\t%.3f\t%d\t%d\t%s\t%s\t%d\t%d\t", t0, sum, cnt, okc, mn, mx, sent, recv);
			for (i = 0; i <= nb; i++) out = out (i > 0 ? " " : "") h[i];
			if (cnt >= chunk) {
				print out >> (SEG);
				close(SEG);
				z = "";
				for (i = 0; i <= nb; i++) z = z (i > 0 ? " " : "") 0;
				print ts "\t0\t0\t0\t-\t-\t0\t0\t" z;
			} else {
				print out;
			}
		}
	' > "$tmpf" && mv "$tmpf" "$curf"

	# 段数量裁剪（丢弃最老的段）
	if [ -f "$segf" ]; then
		c=$(wc -l < "$segf")
		if [ "$c" -gt "$segs_max" ]; then
			tail -n "$segs_max" "$segf" > "$tmpf" && mv "$tmpf" "$segf"
		fi
	fi
}

trim_ring() {
	local f="$RING_DIR/$1.tsv" c
	[ -f "$f" ] || return 0
	c=$(wc -l < "$f")
	if [ "$c" -gt "$G_MAX_POINTS" ]; then
		tail -n "$G_MAX_POINTS" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
	fi
}

# ---------------------------------------------------------------- 一轮检测
run_round() {
	local now id name host region proto timeout tinterval family iface source label remark
	local st last next plast pok peno sfail sok last_ok total
	local iv tv running=0

	now=$(date +%s)
	running=0

	while IFS="$TAB" read -r id name host region proto timeout tinterval family iface source label remark; do
		[ -n "$id" ] || continue
		# 还原写入时的空字段占位符
		[ "$name" = '-' ] && name=''
		[ "$iface" = '-' ] && iface=''
		[ "$source" = '-' ] && source=''
		[ "$label" = '-' ] && label=''
		[ "$remark" = '-' ] && remark=''

		last=0; next=0; plast='-'; pok=0; peno=0; sfail=0; sok=0; last_ok=0; total=0
		st="$STATE_DIR/$id"
		if [ -f "$st" ]; then
			IFS="$TAB" read -r last next plast pok peno sfail sok last_ok total < "$st"
		fi
		is_uint "$last" || last=0

		iv=$(target_interval "$tinterval")
		if [ $((last + iv)) -gt "$now" ]; then
			continue
		fi

		tv=$(target_timeout "$timeout")
		# 目标级接口/源地址未设置时回退到全局
		[ -n "$iface" ] || iface="$G_IFACE"
		[ -n "$source" ] || source="$G_SOURCE"
		case "$family" in
			auto) family="$G_FAMILY" ;;
		esac

		run_check "$id" "$host" "$tv" "$family" "$iface" "$source" &
		running=$((running + 1))
		if [ "$running" -ge "$G_CONCURRENCY" ]; then
			wait
			running=0
		fi
	done < "$RUN_DIR/targets.tsv"

	[ "$running" -gt 0 ] && wait

	collect_results "$now"
}

collect_results() {
	local now="$1"
	local id name host region proto timeout tinterval family iface source label remark
	local res lat ok eno sent recv
	local st last next plast pok peno sfail sok last_ok total
	local iv

	while IFS="$TAB" read -r id name host region proto timeout tinterval family iface source label remark; do
		[ -n "$id" ] || continue
		# 还原写入时的空字段占位符
		[ "$name" = '-' ] && name=''
		[ "$iface" = '-' ] && iface=''
		[ "$source" = '-' ] && source=''
		[ "$label" = '-' ] && label=''
		[ "$remark" = '-' ] && remark=''
		res="$TMP_DIR/$id.res"
		[ -f "$res" ] || continue

		IFS="$TAB" read -r lat ok eno sent recv < "$res"
		rm -f "$res"

		last=0; next=0; plast='-'; pok=0; peno=0; sfail=0; sok=0; last_ok=0; total=0
		st="$STATE_DIR/$id"
		if [ -f "$st" ]; then
			IFS="$TAB" read -r last next plast pok peno sfail sok last_ok total < "$st"
		fi
		is_uint "$total" || total=0
		is_uint "$sfail" || sfail=0
		is_uint "$sok" || sok=0
		is_uint "$last_ok" || last_ok=0

		iv=$(target_interval "$tinterval")

		if [ "$ok" = "1" ]; then
			sok=$((sok + 1))
			sfail=0
			last_ok=$now
		else
			sfail=$((sfail + 1))
			sok=0
		fi
		total=$((total + 1))

		# 状态翻转时才写日志，避免刷屏
		if [ "$pok" != "$ok" ]; then
			if [ "$ok" = "1" ]; then
				log_msg info "target '$name' ($host) recovered, latency ${lat}ms"
			else
				log_msg warning "target '$name' ($host) check failed (errno=$eno)"
			fi
		else
			if [ "$sfail" = "$G_FAIL_WARN" ] || [ "$sfail" = "$G_FAIL_CRITICAL" ]; then
				log_msg warning "target '$name' ($host) failed $sfail consecutive times"
			fi
		fi

		printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
			"$now" "$((now + iv))" "$lat" "$ok" "$eno" "$sfail" "$sok" "$last_ok" "$total" > "$st"

		printf '%s\t%s\t%s\t%s\n' "$now" "$lat" "$ok" "$eno" >> "$RING_DIR/$id.tsv"
		trim_ring "$id"

		update_stats "$id" "$now" "$lat" "$ok" "$sent" "$recv"
	done < "$RUN_DIR/targets.tsv"

	printf '%s\n' "$now" > "$RUN_DIR/tick"
	maybe_persist "$now"
}

# ---------------------------------------------------------------- 持久化
maybe_persist() {
	[ "$G_PERSISTENCE" = "1" ] || return 0
	local now="$1"
	local id name host region proto timeout tinterval family iface source label remark
	local retention cut last pf lastf agg

	retention=$(retention_seconds "$G_HISTORY")
	cut=$((now - retention))

	while IFS="$TAB" read -r id name host region proto timeout tinterval family iface source label remark; do
		[ -n "$id" ] || continue
		# 还原写入时的空字段占位符
		[ "$name" = '-' ] && name=''
		[ "$iface" = '-' ] && iface=''
		[ "$source" = '-' ] && source=''
		[ "$label" = '-' ] && label=''
		[ "$remark" = '-' ] && remark=''
		[ -f "$RING_DIR/$id.tsv" ] || continue

		pf="$PERSIST_DIR/$id.agg"
		lastf="$PERSIST_DIR/$id.last"

		last=0
		if [ -f "$lastf" ]; then
			read -r last < "$lastf"
		else
			last=$((now - G_PERSIST_INTERVAL))
		fi
		is_uint "$last" || last=$((now - G_PERSIST_INTERVAL))

		[ $((last + G_PERSIST_INTERVAL)) -gt "$now" ] && continue

		agg=$(awk -F'\t' -v last="$last" -v nowv="$now" '
			$1 > last {
				n++;
				if ($3 == "1") {
					ok++;
					s += $2;
					if (mn == "" || $2 + 0 < mn + 0) mn = $2;
					if (mx == "" || $2 + 0 > mx + 0) mx = $2;
				}
			}
			END {
				if (n > 0) {
					printf "%d\t%.2f\t%s\t%s\t%d\t%d\t%.1f\n", nowv, (ok ? s / ok : 0),
						(mn == "" ? "-" : mn), (mx == "" ? "-" : mx), ok + 0, n, (n - ok) * 100.0 / n;
				}
			}
		' "$RING_DIR/$id.tsv")

		if [ -n "$agg" ]; then
			printf '%s\n' "$agg" >> "$pf"
		fi
		printf '%s\n' "$now" > "$lastf"

		if [ -f "$pf" ]; then
			awk -F'\t' -v c="$cut" '$1 >= c' "$pf" > "$pf.tmp" && mv "$pf.tmp" "$pf"
		fi
	done < "$RUN_DIR/targets.tsv"
}

# ---------------------------------------------------------------- 主循环
sleep_tick() {
	local i=0
	while [ "$i" -lt "$G_INTERVAL" ]; do
		sleep 1
		i=$((i + 1))
		[ "$RELOAD" = "1" ] && break
		[ "$STOP" = "1" ] && break
	done
}

cleanup() {
	rm -f "$TMP_DIR"/* 2>/dev/null
	log_msg info "daemon exited"
}

main() {
	# 先建立目录，load_config 会向 $RUN_DIR 写入目标清单
	setup_dirs
	load_config
	if [ "$G_PERSISTENCE" = "1" ]; then
		mkdir -p "$PERSIST_DIR"
	fi

	trap 'RELOAD=1' HUP
	trap 'STOP=1' TERM INT
	trap 'cleanup' EXIT

	log_msg info "daemon started (interval=${G_INTERVAL}s, timeout=${G_TIMEOUT}s, targets=$(wc -l < "$RUN_DIR/targets.tsv"))"

	while [ "$STOP" != "1" ]; do
		if [ "$RELOAD" = "1" ]; then
			RELOAD=0
			load_config
			setup_dirs
			log_msg info "configuration reloaded"
		fi

		if [ "$G_ENABLED" != "1" ]; then
			sleep 5
			continue
		fi

		run_round
		sleep_tick
	done
}

main "$@"
