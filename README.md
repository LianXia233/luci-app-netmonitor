# luci-app-netmonitor（网络质量监控）

面向 **OpenWrt 主线（upstream / mainline）** 的网络延迟与网络联通性监控插件。
后台由 `procd` 托管一个常驻探测守护进程，LuCI 页面只负责读取状态与曲线，
**关闭浏览器页面后监控依然持续运行**。

菜单位置：**状态 → 网络质量监控（Network Monitor）**

---

## 一、设计原则

| 原则 | 落地方式 |
| --- | --- |
| 主线兼容优先 | 只使用 LuCI / UCI / ubus / ucode / procd / rpcd / shell / HTML5 / CSS3 / 原生 JS / SVG，不依赖厂商固件 API、不绑定主题、不引入前端框架 |
| 后台独立运行 | 探测由 procd 单实例守护进程完成，浏览器只读取；开多个标签页不会创建多套 Ping 任务 |
| 低资源占用 | 高频数据全部落在 `/tmp`（tmpfs），默认不写 Flash；统计采用「分段 + 直方图」增量维护，CPU 与历史长度无关 |
| 数据可靠 | 失败与成功严格区分，区分超时 / DNS 失败 / 网络不可达 / 其它错误；失败时延迟为 `null`，绝不用 `0 ms` 冒充 |
| 响应式 | PC 多列卡片、平板自动减列、手机单列；表格横向滚动，不出现页面溢出 |

---

## 二、主要特性

- 默认 10 秒一轮探测，支持 1/5/10/15/30/60/120/300 秒及任意 1–3600 秒自定义值
- 多目标并发探测，并发上限可配（默认 5）
- 每目标可单独设置：名称、地址、区域、自定义标签、地址族、检测间隔、超时、出口接口、源地址、启用状态、备注
- 区域分类：国内 / 国外 / 其他，外加自由自定义标签（香港、日本、DNS、游戏……），**不内置任何 IP 归属库**
- 实时统计：当前 / 最低 / 最高 / 平均 / P50 / P95 / P99 延迟、丢包率、成功率、连续成功与连续失败次数、最后检测时间、最近成功时间
- 质量等级：优秀 / 良好 / 一般 / 较差 / 严重 / 离线，**阈值全部可在页面配置**，不硬编码在前端
- 历史数据：内存环形缓存（默认 4320 点/目标）+ 可选 Flash 持久化（1h / 6h / 12h / 24h / 3d / 7d / 30d）
- 7 个页面：总览、实时监控、延迟曲线、国内/国外、历史数据、目标管理、设置
- 自研 SVG 折线图 / 面积图 / 丢包标记 / Tooltip（鼠标悬停与手机触摸均可查看）
- 24 个内联动态 SVG 图标，全部与真实数据绑定（延迟表盘、成功率 / 丢包率环形进度、
  延迟等级仪表、时钟指针、实时柱状、按失败类型切换的诊断图标），详见第十四章
- 中文（zh_Hans）/ 英文双语，通过 LuCI 标准 i18n 机制
- 通知接口预留（Webhook / Telegram / 企业微信 / 钉钉 / 邮件）

---

## 三、架构

```
LuCI Web UI (HTML5 + CSS3 + 原生 JS + SVG)
        │  ubus / rpcd 权限受控
        ▼
/usr/share/rpcd/ucode/luci.netmonitor        ← 读状态、改配置、控服务
        │  读取 /tmp 与 /etc 下的数据文件
        ▼
/etc/init.d/netmonitor (procd)               ← 启停、respawn、配置变更自动 reload
        │
        ▼
/usr/libexec/netmonitor/netmon-daemon.sh     ← 单实例探测守护进程
        │  ping / ping6（并发受控）
        ▼
/tmp/netmonitor/{ring,hist,state}            ← tmpfs 高频数据（分段 + 直方图）
/etc/netmonitor/history/*.agg                ← 可选 Flash 持久化（按间隔批量落盘）
```

**关键点：检测频率与 UI 刷新频率完全解耦。** 后台默认 10 秒探测一次，
前端默认 2 秒拉取一次最新状态，页面刷新不会触发任何 Ping。

---

## 四、目录结构

```
luci-app-netmonitor/
├── Makefile                                   # 包定义（依赖全为主线组件）
├── LICENSE
├── README.md
├── po/
│   ├── gen_po.py                              # 翻译提取/生成脚本（开发用，不打包）
│   ├── templates/luci-app-netmonitor.pot
│   └── zh_Hans/luci-app-netmonitor.po
├── root/
│   ├── etc/
│   │   ├── init.d/netmonitor                  # procd 服务脚本
│   │   └── uci-defaults/luci-app-netmonitor   # 首次安装写入默认配置
│   └── usr/
│       ├── libexec/netmonitor/
│       │   └── netmon-daemon.sh               # 后台检测守护进程
│       └── share/
│           ├── luci/menu.d/luci-app-netmonitor.json      # 菜单（状态 → 网络质量监控）
│           └── rpcd/
│               ├── acl.d/luci-app-netmonitor.json        # RPC 权限
│               └── ucode/luci.netmonitor                 # RPC 后端
├── tests/
│   ├── test_netmon_daemon.sh                  # 守护进程单元测试（32 条断言）
│   └── test_icons.js                          # 动态 SVG 图标自检（442 条断言）
└── htdocs/luci-static/resources/
    ├── netmonitor/
    │   ├── style.css                          # 全部样式限定在 .nm- 命名空间
    │   ├── common.js                          # RPC 封装、格式化、等级、卡片
    │   ├── icons.js                           # 24 个内联动态 SVG 图标
    │   └── chart.js                           # 自研 SVG 图表
    └── view/netmonitor/
        ├── overview.js  realtime.js  charts.js
        ├── regions.js   history.js   targets.js  settings.js
```

> 不含任何 LuCI 旧版 `luasrc/` 目录：现代主线 LuCI 使用 JS 视图 + ucode RPC，
> 本项目按当前主线结构组织。

---

## 五、编译与安装

### 5.1 放入源码树编译

```bash
cd openwrt
cp -r luci-app-netmonitor package/luci-app-netmonitor
./scripts/feeds update -a && ./scripts/feeds install -a
make menuconfig            # LuCI → Applications → luci-app-netmonitor
make package/luci-app-netmonitor/compile V=s
```

产物：`bin/packages/*/luci/luci-app-netmonitor_1.0.0-r1_all.ipk`

### 5.2 安装到设备

本包 `PKGARCH=all`，架构无关，同一份产物可安装到任意架构设备。

**opkg（OpenWrt 23.05 / 24.10）**

```bash
opkg update
opkg install luci-app-netmonitor luci-i18n-netmonitor-zh_Hans
```

**apk（OpenWrt 25.x 及更新版本）**

```bash
apk update
apk add luci-app-netmonitor luci-i18n-netmonitor-zh_Hans
```

**离线安装**（从构建机拷贝产物）

```bash
scp luci-app-netmonitor_*.ipk luci-i18n-netmonitor-zh_Hans_*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "opkg install /tmp/luci-app-netmonitor_*.ipk /tmp/luci-i18n-netmonitor-zh_Hans_*.ipk"
```

**签名校验失败**（自编译包未签名，opkg 报 `Signature check failed`）：

```bash
opkg install --force-downgrade --force-depends luci-app-netmonitor_*.ipk
# 必要时加 --force-overwrite 覆盖同名文件
```

apk 侧对应参数：

```bash
apk add --allow-untrusted luci-app-netmonitor_*.apk
```

> `--force-downgrade` 用于版本号低于设备已装版本时（重复安装调试版本很常见）。

**安装后必须重载 rpcd 与 uhttpd**，否则 RPC 后端不生效、菜单不出现：

```bash
rm -f /tmp/luci-indexcache*          # 清 LuCI 菜单索引缓存
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

/etc/init.d/netmonitor enable        # 开机自启
/etc/init.d/netmonitor start
/etc/init.d/netmonitor status
```

浏览器进入 **状态 → 网络质量监控**（本插件挂载在一级菜单「状态」下，不是「网络」）。

### 5.3 实机验证步骤（逐条确认）

```bash
# 1) 后台守护进程存活
/etc/init.d/netmonitor status
pgrep -f netmon-daemon

# 2) ubus 对象已注册（未注册说明 rpcd 没重载或 ucode 文件有语法错误）
ubus list | grep netmonitor          # 期望: luci.netmonitor

# 3) 探测链路正常（tick 应随时间递增）
ubus call luci.netmonitor service_status
sleep 12; ubus call luci.netmonitor service_status

# 4) 目标状态：失败时 latency 必须为 null，不能是 0
ubus call luci.netmonitor get_status

# 5) 统计与曲线
ubus call luci.netmonitor get_statistics '{"range":"1h"}'
ubus call luci.netmonitor get_history  '{"range":"1h"}'

# 6) 运行期文件（均在 /tmp，不写 Flash）
ls -la /tmp/netmonitor/{state,ring,hist}/
```

**依赖缺失排查**（ubus 对象不出现、页面报错时）：

```bash
# 逐个确认依赖已安装
for p in luci-base luci-mod-status rpcd rpcd-mod-ucode ucode \
         ucode-mod-fs ucode-mod-uci ucode-mod-ubus ucode-mod-uloop; do
    opkg status "$p" >/dev/null 2>&1 && echo "ok   $p" || echo "MISS $p"
done

# 确认 ucode 插件被 rpcd 加载（语法错误会在此暴露）
ucode -c /usr/share/rpcd/ucode/luci.netmonitor && echo "ucode syntax OK"
/etc/init.d/rpcd restart; sleep 2; ubus list | grep netmonitor
```

**日志查看**

```bash
logread | grep netmonitor            # 服务启停、配置重载、目标状态翻转
logread | grep -i rpcd               # RPC 后端加载失败原因
/etc/init.d/netmonitor stop
/usr/libexec/netmonitor/netmon-daemon.sh   # 前台运行，直接看探测输出（排障首选）
```

> 正常探测不写日志，只有状态翻转（恢复 / 失败）与异常才记录，避免刷屏。

**卸载后复核**

```bash
opkg remove luci-app-netmonitor luci-i18n-netmonitor-zh_Hans
/etc/init.d/rpcd restart
ubus list | grep netmonitor          # 应无输出
```

### 5.4 依赖

本包直接声明的依赖（`Makefile` 中的 `LUCI_DEPENDS`）：

```
luci-base  luci-mod-status
ucode-mod-fs  ucode-mod-uci  ucode-mod-ubus  ucode-mod-uloop
```

运行时实际需要、但由 `luci-base` 传递提供的组件：

```
rpcd  rpcd-mod-file  rpcd-mod-luci  rpcd-mod-ucode  cgi-io  ucode
```

全部为 OpenWrt 主线自带组件，无需额外软件源。

`rpcd` / `rpcd-mod-ucode` / `ucode` 三项**不在本包显式声明**，这是刻意的：`luci-base` 的 `LUCI_DEPENDS` 已完整包含它们，重复声明会在 SDK 构建环境下触发 Kconfig 递归依赖，详见 12.9。

---

## 六、UCI 配置说明（`/etc/config/netmonitor`）

### 6.1 global 段

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `1` | 监控总开关 |
| `interval` | `10` | 全局检测间隔（秒），范围 1–3600，推荐 1/5/10/15/30/60/120/300 |
| `timeout` | `3` | Ping 超时（秒），1–30 |
| `count` | `1` | 每次检测的发包数，1–20 |
| `concurrency` | `5` | 并发检测目标数上限，1–50 |
| `address_family` | `auto` | `auto` / `ipv4` / `ipv6` / `both` |
| `interface` | 空 | 出口接口（如 `wan`、`wwan`），空则走系统默认路由 |
| `source` | 空 | 源地址 |
| `persistence` | `0` | 是否开启 Flash 持久化历史 |
| `history` | `24h` | 持久化保留时间：1h/6h/12h/24h/3d/7d/30d |
| `persist_interval` | `300` | 落盘间隔（秒），60–3600 |
| `max_points` | `4320` | 每目标内存环形缓存点数（10s × 4320 ≈ 12 小时） |
| `ui_refresh` | `2` | 前端刷新间隔（秒），1–60 |
| `log_level` | `info` | `debug` / `info` / `warning` / `error` |
| `fail_warn` / `fail_critical` | `3` / `5` | 连续失败告警 / 严重阈值 |
| `loss_warn` / `loss_critical` | `5` / `20` | 丢包率告警 / 严重阈值（%） |
| `latency_excellent` | `50` | 优秀阈值（ms） |
| `latency_good` | `100` | 良好阈值（ms） |
| `latency_fair` | `200` | 一般阈值（ms） |
| `latency_poor` | `500` | 较差阈值（ms） |
| `notify_enabled` / `notify_url` | `0` / 空 | 通知接口预留 |

### 6.2 target 段（可多个）

```
config target 'baidu'
	option name     'Baidu'
	option host     'www.baidu.com'
	option region   'cn'          # cn | overseas | other
	option label    ''            # 自定义标签，如 香港 / 日本 / DNS / 游戏
	option proto    'icmp'
	option family   'auto'        # auto | ipv4 | ipv6 | both
	option interval '0'           # 0 = 跟随全局
	option timeout  '3'           # 0 = 跟随全局
	option interface ''
	option source   ''
	option enabled  '1'
	option remark   ''
```

默认配置提供 4 个示例目标（百度、阿里 DNS、Cloudflare、Google DNS），
其中 2 个默认启用、2 个默认禁用，**可任意修改或删除**。

命令行示例：

```bash
uci set netmonitor.myhost=target
uci set netmonitor.myhost.name='MyHost'
uci set netmonitor.myhost.host='example.com'
uci set netmonitor.myhost.region='overseas'
uci set netmonitor.myhost.enabled='1'
uci commit netmonitor
/etc/init.d/netmonitor reload
```

---

## 七、RPC 接口（ubus 对象 `luci.netmonitor`）

权限由 `/usr/share/rpcd/acl.d/luci-app-netmonitor.json` 控制，
未授权用户无法调用写操作。

| 方法 | 权限 | 说明 |
| --- | --- | --- |
| `get_status` | read | 全局与每目标实时状态、区域聚合、阈值、迷你曲线 |
| `get_targets` | read | 目标配置列表 |
| `get_history` | read | 指定范围/目标/区域的历史点（自动降采样） |
| `get_statistics` | read | 指定范围的聚合统计（平均/最大/最小/P50/P95/丢包/成功率） |
| `get_config` | read | 全局配置 |
| `set_config` | write | 修改全局配置（白名单 + 范围校验） |
| `add_target` / `update_target` / `delete_target` | write | 目标增删改 |
| `move_target` / `copy_target` / `batch_targets` | write | 排序 / 复制 / 批量启停 |
| `clear_history` | write | 清空内存与持久化历史 |
| `service_status` | read | 服务运行状态与心跳 |
| `start_service` / `stop_service` / `restart_service` | write | 服务控制 |

调试调用：

```bash
ubus call luci.netmonitor get_status '{}'
ubus call luci.netmonitor get_history '{"range":"1h","max_points":300}'
ubus list luci.netmonitor
```

返回结构中的延迟字段：成功为数值（ms），失败为 `null`。

---

## 八、数据存储与 Flash 保护

| 数据 | 位置 | 写入频率 |
| --- | --- | --- |
| 原始采样点 | `/tmp/netmonitor/ring/<id>.tsv` | 每次探测追加 1 行（tmpfs，不损耗 Flash） |
| 统计段 + 直方图 | `/tmp/netmonitor/hist/<id>.{cur,seg}` | 每次探测更新 1 行 |
| 目标运行状态 | `/tmp/netmonitor/state/<id>` | 每次探测重写（极小） |
| 持久化聚合桶 | `/etc/netmonitor/history/<id>.agg` | 仅在开启持久化时，每 `persist_interval` 秒写 1 行 |

要点：

1. **默认不写 Flash**（`persistence=0`）。
2. 持久化写入的是**聚合桶**（一段窗口的 avg/min/max/loss），不是原始点，
   30 天 @5 分钟粒度也只有约 8640 行/目标。
3. 落盘时按保留时间裁剪，文件不会无限增长。
4. 统计采用 60 点一段 + 17 桶直方图：每轮只做 O(1) 增量更新，
   P50/P95/P99 由直方图插值估算，**不会每轮全量重算历史**。
5. 内存采样点数由 `max_points` 限制，超出自动裁掉最老数据。

---

## 九、卸载

```bash
/etc/init.d/netmonitor stop
/etc/init.d/netmonitor disable
opkg remove luci-app-netmonitor
rm -rf /tmp/netmonitor          # 运行期数据（可省略，重启即失）
rm -rf /etc/netmonitor          # 持久化历史（确认不再需要时执行）
```

配置文件 `/etc/config/netmonitor` 由 opkg 保留（如需彻底清除请手动删除）。
由于默认配置通过 `uci-defaults` 注入，卸载后重装不会覆盖已有配置。

---

## 十、调试方法

### 10.1 查看日志

```bash
logread | grep netmonitor
# 打开 debug
uci set netmonitor.global.log_level='debug'; uci commit netmonitor
/etc/init.d/netmonitor reload
```

正常探测**不写日志**；只在状态翻转、连续失败达到阈值、配置重载、服务启停时记录。

### 10.2 前台运行守护进程（排障首选）

```bash
/etc/init.d/netmonitor stop
sh -x /usr/libexec/netmonitor/netmon-daemon.sh
```

### 10.3 检查数据文件

```bash
ls -l /tmp/netmonitor/state/          # 每个目标一行运行状态
tail -n 5 /tmp/netmonitor/ring/baidu.tsv     # 原始采样：t latency ok errno
cat /tmp/netmonitor/hist/baidu.cur    # 当前统计段
cat /tmp/netmonitor/tick              # 最近一次心跳时间戳
```

错误码：`0` 成功、`1` 超时、`2` DNS 解析失败、`3` 网络不可达、`4` 其它错误、`5` 目标非法。

### 10.4 手工验证 RPC

```bash
ubus call luci.netmonitor service_status '{}'
ubus call luci.netmonitor get_status '{"spark":true}' | head -c 800
```

### 10.5 常见问题

| 现象 | 排查 |
| --- | --- |
| 页面一直显示"暂无监控数据" | ① 服务是否运行 `/etc/init.d/netmonitor status`；② 是否有启用目标 `uci show netmonitor \| grep enabled`；③ 心跳文件 `/tmp/netmonitor/tick` 是否更新 |
| 目标一直 DNS 解析失败 | 检查路由器 DNS 配置；域名是否被劫持；可先换成 IP 测试 |
| 改动配置不生效 | procd 会监听 `/etc/config/netmonitor`，若未触发可手动 `/etc/init.d/netmonitor reload` |
| 页面样式异常 | 确认 CSS 已加载（浏览器开发工具搜索 `.nm-root`）；本页面样式全部在 `.nm-` 命名空间内，不会与其它主题冲突 |
| 中文未生效 | 确认已安装 `luci-i18n-netmonitor-zh-cn` 或编译时选中 Languange 中的 Chinese；必要时在 LuCI 中切换语言 |
| 服务反复重启 | 查看 `logread`，通常为配置非法（如 host 含空格）导致；修正后 `restart` |

---

## 十一、测试清单

### 编译测试

```bash
make package/luci-app-netmonitor/compile V=s
```

### 服务测试

```bash
/etc/init.d/netmonitor start
/etc/init.d/netmonitor status
/etc/init.d/netmonitor restart
/etc/init.d/netmonitor reload
/etc/init.d/netmonitor enable
/etc/init.d/netmonitor disable
```

### 配置测试

```bash
uci show netmonitor
```

### 网络测试矩阵

| 场景 | 期望 |
| --- | --- |
| IPv4 地址可达 | 正常延迟，状态在线 |
| IPv4 域名可达 | 正常延迟；DNS 正常 |
| IPv6 地址可达 | 走 `ping6`，正常延迟 |
| 不可达地址 | 状态失败，错误类型为超时 |
| 不存在域名 | 明确显示 **DNS 解析失败**，而非"Ping 失败" |
| 断网 | 显示网络不可达或超时，连续失败达到阈值后等级下沉 |
| 丢包网络 | 丢包率上升，图上出现丢包标记 |

### UI 测试

桌面 / 手机 / 浅色 / 深色 / 默认 LuCI 主题 均需检查：
无横向溢出、按钮可点、文字不截断、表格可横向滚动。

### 异常测试

- 目标不可达、网络断开、DNS 异常
- 杀掉守护进程：`kill -9 $(cat /var/run/netmonitor.pid)` → procd 应在数秒内 respawn
- 写入非法配置 → 服务应拒绝或回退到默认值而不是崩溃

### 单元测试

守护进程的三块核心逻辑（ping 解析 / 错误分类、targets.tsv 解析、分段直方图）
有可重复运行的单元测试，覆盖 32 条断言：

```sh
# 开发机（Git Bash / Linux）与设备上均可运行
sh tests/test_netmon_daemon.sh
```

测试要点：

- 用 `sed` 截掉 `main() {` 及之后的分发段，把脚本当库加载，避免执行主循环。
- 用 **shell 函数**做命令替身（`ping` / `logger` / `rm`），而不是 stub 目录前置 PATH。
  原因见下文 12.4，PATH 前置无法覆盖本环境下的 `rm` shim。
- 第 2 组用例是**回归护栏**：它断言「不带占位符的旧 tsv 写法确实会字段错位」，
  而不只是「新写法能用」。这样一旦有人改回旧写法，测试会立刻失败。

前端动态图标另有一套 442 条断言的自检，不需要设备即可运行：

```sh
# 需要 Node.js（不依赖浏览器）
node tests/test_icons.js
```

测试要点：

- 导出完整性：24 个图标函数全部存在且可调用。
- 结构合法性：每个图标在多种输入下都返回**恰好一个** `<svg>` 根节点，
  且不含 `undefined` / `NaN` 泄漏到属性里。
- 数据变化性：13 组「不同输入必须产生不同输出」的断言，防止图标退化成装饰。
- 数据语义：有数据时不得输出 `--` 占位，无数据时不得伪造 `0ms`；
  尺寸阈值以下必须真的不绘制文字。
- 调用一致性：扫描 7 个页面源码，凡出现 `icons.xxx()` 的名字必须在 `icons.js` 中导出。

---

## 十二、开发约定与踩坑记录

以下每一条都在 ImmortalWrt SNAPSHOT（aarch64，LuCI Master 26.246）实机上验证过，
是本项目的硬约束，改动相关代码时请一并遵守。

### 12.1 rpcd ucode 插件：参数一律以字符串传递

`rpcd-mod-ucode` 调用 ucode 方法时，**第一个参数是 request 资源对象，实参在
`request.args` 里**，不是「第一个参数即参数对象」：

```ucode
// 正确
call: function(req) {
    const a = (type(req?.args) == 'object') ? req?.args : {};
    // 用 a.id、a.name …
}

// 错误：a 是 resource，a.id 恒为 null
call: function(a) { /* a.id */ }
```

实测约束（同一台设备）：

| 传入值 | 结果 |
|---|---|
| `{"x":"1"}`（字符串） | 正常 |
| `{"x":1}`（数字字面量） | `Invalid argument` |
| `{"x":true}`（布尔字面量） | `Invalid argument` |
| `{"x":["a"]}`（数组字面量） | `Invalid argument` |
| 未在 `args` 中声明的键 | `Invalid argument` |

因此：

1. 方法必须在 `args` 里声明**每一个**可能的键，缺一个键该调用就会被拒绝。
2. 前端统一把标量序列化为字符串，数组转成逗号分隔列表（见 `common.js` 的 `strParams`）。
   例如批量操作传 `ids: "baidu,cloudflare"`，后端用 `split(a.ids, ',')` 解析。
3. `args` 里写的类型值（`'string'` / `'array'` / 任意占位串）只作占位，实际只接受字符串。

### 12.2 rpcd ucode 插件：返回结构必须是 `{ '<ubus对象名>': methods }`

```ucode
return { 'luci.netmonitor': methods };   // 正确
return methods;                          // 对象不会注册，ubus list 看不到
```

### 12.3 LuCI 前端：工具模块必须 `return Class.extend({...})`

LuCI 的模块加载器要求 factory 返回**类**，加载器随后 `new` 出实例并注入给依赖方：

```js
// luci.js 加载器逻辑
_class = _factory(...);
if (!Class.isSubclass(_class))
    error('"%s" factory yields invalid constructor', name);
const instance = new _class();   // 注入给依赖方的就是这个实例
```

- 工具模块（`common.js` / `icons.js` / `chart.js`）：用 `return Class.extend({...});`
- 页面模块（`view/netmonitor/*.js`）：用 `return view.extend({...});`
- **不要用 `Class.singleton({...})`**：它等价于 `Class.extend().instantiate()`，
  返回的是**实例**，必然触发 `factory yields invalid constructor`。
- 依赖注入进来的已经是实例，可以直接 `common.api.xxx()`。
- 引用带点号的模块要显式别名：`'require netmonitor.common as common';`
  （加载器会把点号替换成下划线，不写别名拿不到变量）。

### 12.4 targets.tsv：空字段必须写占位符，否则字段整体错位

TAB 属于 IFS **空白字符**，POSIX shell 的 `read` 会合并连续分隔符。
当 `iface` / `source` / `label` / `remark` 为空时会产生连续 TAB，导致后面的字段
整体左移：

```
# 错误写法（空字段留空）
alidns \t AliDNS \t 223.5.5.5 \t ... \t ipv4 \t \t \t DNS \t
                                              ↑ 连续 TAB 被合并
实际解析：iface = "DNS"   ← label 左移到了 iface
后果：执行 ping -I DNS 223.5.5.5 → busybox 报 bad address 'DNS'
      → 被错误归类成「DNS 解析失败」
```

修复：写入时把空字段写成 `-`，读取后还原为空（见 `netmon-daemon.sh` 的
`nm_append_target` 与三处 `read` 之后）。保证每行字段数恒为 12。

### 12.5 行尾必须 LF

OpenWrt 的 shell 是 BusyBox ash，CRLF 会让 `\r` 成为脚本内容的一部分，
表现为 procd 启动失败或命令解析异常。`.sh` / `.py` / 配置脚本与 RPC 文件一律 LF。
仓库根目录已放 `.gitattributes`（`* text=auto eol=lf`）作结构性保障。

### 12.6 uci-defaults 不会隐式创建配置文件

部分设备的 `uci set` 不会自动创建 `/etc/config/<name>`（报 `Entry not found`）。
`uci-defaults` 脚本里要先兜底：

```sh
[ -f "/etc/config/$NM_CFG" ] || : > "/etc/config/$NM_CFG"
```

另外 SSH 通道下 heredoc 容易被吞，建议用 `printf` 管道喂 `uci -q batch`。

### 12.7 i18n 模块并非所有固件都存在

`L.require('i18n')` 在精简固件上会产生 404（该文件不存在），
且这是**网络层错误，JS 的 catch 无法消除**，会一直出现在控制台。
因此只在 LuCI 已注册 i18n 能力时才调用，否则交给服务端注入的翻译表。

### 12.8 排查：部署后菜单不出现

删掉 LuCI 的索引缓存并重启 rpcd：

```sh
rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache
/etc/init.d/rpcd restart
```

### 12.9 SDK 构建：CI 环境变量 `PKG_NAME` 污染包元数据扫描，使 `package/<name>/compile` 目标消失

**现象**：GitHub Actions 中 `make defconfig` 步骤退出码为 0（`.config` 正常写出、
`CONFIG_TARGET_*` 符号齐全），下一步却报

```
make[1]: *** No rule to make target 'package/luci-app-netmonitor/compile'.  Stop.
make: *** [include/toplevel.mk:226: package/luci-app-netmonitor/compile] Error 2
```

同时诊断输出显示 `tmp/.packageinfo` 里 `^Package: luci-app-netmonitor$` 有 **146 条**
（不同 SDK 版本为 146/148 条），且这些同名条目的 `Submenu` / `Depends` 各不相同：

```
33544:Package: luci-app-netmonitor
33545-Submenu: 1. Collections
33547-Depends: +libc +luci-light +luci-app-package-manager   # 字段实为 luci 元包的
33567:Package: luci-app-netmonitor
33568-Submenu: 3. Applications
33570-Depends: +libc +luci-base +acme                        # 字段实为 luci-app-acme 的
```

**根因**：CI 工作流曾定义了 workflow 级环境变量 `PKG_NAME: luci-app-netmonitor`。
OpenWrt 的包元数据扫描链路（`include/toplevel.mk` -> `include/scan.mk`）会对每个包目录
发起一次 DUMP 子 make（`--no-print-dir -r DUMP=1 -C package/<dir>`），子 make 继承环境变量；
而 `luci.mk` 用

```makefile
PKG_NAME?=$(LUCI_NAME)
LUCI_NAME?=$(notdir ${CURDIR})
```

推导包名——make 把环境变量视为"已定义"，`?=` 不会覆盖，于是**整个 luci feed 的每个包
都把自己的包名钉成了 `luci-app-netmonitor`**（只有包名行被污染，Depends/Submenu 等字段
仍是各包自己的，这就是上面"同名却字段各异"的由来）。

后果链：

1. 上百个包共用同一个 Kconfig symbol `PACKAGE_luci-app-netmonitor`，`tmp/.config-package.in`
   里出现大量 `recursive dependency detected!`（自依赖，或经 `select` 派生的跨包假环）；
2. `tmp/.packagedeps`（`package/Makefile` 的 `builddirs` 数据源）里所有行都变成
   `package-$(CONFIG_PACKAGE_luci-app-netmonitor) += <别人的目录>`，符号语义彻底错乱；
3. 最终 `package/luci-app-netmonitor/compile` 目标不再生成——错误信息指向"目标缺失"，
   与真正的 Kconfig 失败相距甚远，极具迷惑性。

**两个重要的排除项**（都有日志实锤，排查时不要再绕进去）：

- `recursive dependency detected` 是**伴生噪音而非失败原因**：SDK/feeds 本来就有一批
  （nginx-mod-* 十余条自依赖、`LIBCURL_LDAP`、`GENSIO_SSHD` 等），`make defconfig`
  报了这些 error 后仍然退出 0 并写出 `.config`。
- `scan.mk` 对每个包是**独立子 make 进程**（日志 2041 条 `Collecting package info`
  对应 2041 次静默子 make；`--no-print-dir` 让它们不打印 Entering directory），
  makefile 内的变量**不可能**跨包残留——所以"上一个包的 `PKG_NAME:=` 污染下一个包"
  的经典解释在这里不成立，唯一能跨进程渗入的就是**环境变量**。

**修法**：

1. 工作流变量改名 `NM_PKG`（`.github/workflows/build.yml`），全部引用同步替换；
   并在进入 SDK 的步骤加防御线 `unset PKG_NAME || true`。
2. `Makefile` 不设置 `PKG_NAME`、不设置 `LUCI_PKGARCH`（默认即 `all`），与上游 luci feed
   惯例一致；内部变量加 `NETMONITOR_` 前缀避免同名干扰。
3. 依赖不重复声明 `+rpcd` / `+rpcd-mod-ucode` / `+ucode`：`luci-base` 的 `LUCI_DEPENDS`
   已包含（实机 `apk info -R luci-base` 可验证，且实测不含 `ucode-mod-uloop`，需自留）。
4. Configure 步骤自愈逻辑保留：检出 `recursive dependency detected` 时只清理 `tmp/` 下
   可再生索引并重跑一次；打印 `.packageinfo` / 生成的 Kconfig 片段便于定位。

**关键约束：绝不能删除 `Config-build.in`**。它属于 Kconfig 输入（不是 `tmp/` 下的
可再生生成物），删掉后构建会立刻变成另一个错误：

```
Config.in:153: glob failed: No files found "Config-build.in"
```

**判据与速查**：

- `.packageinfo` 中 `grep -c '^Package: luci-app-netmonitor$'` 必须为 **1**（>1 即环境
  变量泄漏，先 `env | grep PKG_NAME` 排查 CI 定义）；
- `grep -B1 '^Package: luci-app-netmonitor$' tmp/.packageinfo` 可列出每条同名条目的
  `Source-Makefile:` 路径，直接看清污染来自哪些目录；
- `target symbols:` 必须非 0（`.config` 含目标符号，说明 Kconfig 写出成功）。

---

## 十三、兼容性

- 目标平台：OpenWrt 主线（23.05 / 24.x 及更新版本），兼容其衍生发行版
- LuCI：现代 JS 视图 + ucode RPC 架构（传统 Lua CBI 版本不适用）
- 探测命令：busybox `ping` / `ping6`，同时兼容 iputils 输出格式
- 主题：仅使用主题提供的 CSS 变量与 `.nm-` 私有命名空间，不影响其它页面

---

## 十四、动态 SVG 图标与动画系统

全部图标在 `htdocs/luci-static/resources/netmonitor/icons.js` 中用内联 SVG 绘制，
不引用任何图标 CDN、图标字体或位图。共 24 个图标，统一使用 `0 0 120 120` 视口
（`dot()` 为 10×10 的微型状态点，用于表格行首）。

设计原则只有一条：**图标是数据可视化，不是装饰**。同一个函数在不同真实数据下
输出不同的结构、颜色与动画速度；任何图标都不会在缺少数据时伪造一个数值。

### 14.1 图标含义与绑定字段

| # | 函数 | 含义 | 绑定的真实数据 |
|---|------|------|----------------|
| 01/02 | `health(state, size)` | 总体健康 / 异常 | `get_status.health`（good / warning / critical / unknown） |
| 03 | `ping(size, opts)` | Ping 探测 | 探测等级；DNS 失败时整体转为橙色 |
| 04 | `latencyDial(ms, grade, size)` | 实时延迟表盘 | 中心数字 = `overall.current`，配色 = 阈值判定等级 |
| 05 | `online(size, ok)` | 在线状态 | `targets[].status`（在线时虚线环流动，离线时静止变灰） |
| 06 | `packetLoss(pct, size)` | 丢包检测 | `loss`：0% 画绿色对勾，>0% 画红色叉号 |
| 07 | `highLatency(ms, grade, size)` | 高延迟波形 | 目标延迟与等级（poor / severe 时波形转橙红） |
| 08 | `dnsFail(size)` | DNS 解析失败 | `targets[].last_error == 'dns'` |
| 09 | `regionCN(size, region, ms)` | 国内网络 | `regions.cn`：abnormal > 0 时节点转红并叠加告警环 |
| 10 | `regionGlobal(size, region, ms)` | 国外网络 | `regions.overseas` |
| 11 | `gradeGauge(ms, grade, size)` | 延迟等级仪表 | 指针角度与彩色弧长均由阈值等级换算 |
| 12 | `trend(size)` | 统计趋势 | 曲线卡片标识 |
| 13 | `iface(up, size)` | 网络接口 | 接口链路状态（down 时指示灯闪烁） |
| 14 | `service(state, size)` | 服务状态 | `get_status.running`（停止时外环反转、指示灯闪烁） |
| 15 | `multiTarget(list, size)` | 多目标监控 | 最多 3 个目标的圆点颜色（等级 → 状态 → 启用 → 中立色） |
| 16 | `successRing(pct, size)` | 成功率圆环 | 弧长 = 按样本加权的 `success_rate` |
| 17 | `lossRing(pct, size)` | 丢包率圆环 | 弧长 = `loss`；0% 时弧长为 0，不会伪造一个绿色满环 |
| 18 | `clock(ts, size)` | 检测时间 | 时针 / 分针角度由 `tick`、`last_check` 的真实时间换算 |
| 19 | `gear(size)` | 设置 | 设置页当前生效参数 |
| 20 | `database(size)` | 历史数据 | 数据来源（内存 / 持久化）与保留期 |
| 21 | `bell(count, size)` | 异常提醒 | `overall.offline`：为 0 时显示绿色对勾而非红色徽标 |
| 22 | `dualStack(family, v4, v6, size)` | IPv4 / IPv6 | `address_family` 与目标地址族，未启用的一侧变灰 |
| 23 | `liveBars(values, size)` | 实时统计柱状 | 各目标当前延迟，柱高按最大值归一化 |
| 24 | `responsive(size)` | 响应式布局 | 小屏表格可横向滚动的说明 |

### 14.2 环形进度的算法

圆环半径固定 `r = 38`，周长 `C = 2πr ≈ 238.76`。进度弧通过内联
`stroke-dasharray: <C × ratio> <C>` 表达，并 `rotate(-90 60 60)` 让起点回到 12 点方向。

因此弧长是数值的线性映射，可以直接反算校对：

| 显示值 | stroke-dasharray | 校验 |
|--------|------------------|------|
| 成功率 100% | `238.8 238.8` | 满环 |
| 成功率 75% | `179.1 238.8` | 179.1 / 238.8 = 0.75 |
| 丢包率 25% | `59.7 238.8` | 59.7 / 238.8 = 0.25 |
| 丢包率 0% | `0.0 238.8` | 不绘制弧，只保留底色环 |

`online()` 的在线弧使用 `r = 40`（周长 251.3），`gradeGauge()` 使用半圆弧
（`r = 42`，弧长 ≈ 131.9）。

### 14.3 动画实现与性能约束

动画全部由 CSS 完成（不使用 SMIL `<animate>`），只驱动三个属性：

| 关键帧 | 作用属性 | 使用场景 |
|--------|----------|----------|
| `nm-dash-v3` / `nm-dash-v3-rev` | `stroke-dashoffset` | 虚线环流动（在线、接口、趋势、DNS 失败的对勾路径） |
| `nm-pulse-soft` | `opacity` | 节点 / 数据点呼吸 |
| `nm-ring-scale` | `transform: scale()` + `opacity` | 告警环扩散 |
| `nm-bars` | `transform: scaleY()` | 柱状图错峰起伏 |
| `nm-blink-soft` | `opacity` | 失效状态闪烁 |
| `nm-rotate` | `transform: rotate()` | 齿轮旋转、在线环旋转 |

三条约束：

1. **位移量取虚线周期的整数倍**。`stroke-dasharray: 5 9` 的周期是 14，
   位移量取 70（= 5 个周期），首尾状态严格重合，循环处不会跳帧。
2. **`transform` 必须配 `transform-box: fill-box`**，让旋转 / 缩放围绕元素自身
   包围盒进行，规避各浏览器对 SVG `transform-origin` 的解析差异。
3. **不使用 `filter`、`blur`、大面积 `box-shadow`**，避免在低端路由设备上产生
   离屏合成开销。整套动画只作用于合成层属性，不触发重排。

`@media (prefers-reduced-motion: reduce)` 下 `.nm-root * { animation: none !important }`，
用户系统的减少动效偏好会被严格尊重。

### 14.4 文字可读性阈值

图标统一按 120×120 绘制，字号随渲染尺寸等比缩小：`font-size: 23` 在 44px 的图标里
只剩 8.4px，`font-size: 11` 更是只剩 4px —— 渲染出来是一团噪点，不是信息。
因此约定：

| 阈值 | 内容 | 说明 |
|------|------|------|
| ≥ 60px | 主数值（延迟数字、圆环百分比） | 实际高度约 11.5px，可读 |
| ≥ 84px | 辅助文字（ms、IPv4 / IPv6、目标名、告警计数） | 实际高度约 9px，可读 |

低于阈值时只保留图形本身，数值由旁边的真实文字承担。例如目标卡片中 44px 的
丢包 / 成功率圆环不绘制中心百分比，而是在右侧以 `<b>0%</b>` 呈现。

### 14.5 图标在页面上的分布

| 页面 | 动态图标 |
|------|----------|
| 总览 | 健康环（76px 主视觉）、6 张 KPI 卡的右上角图标、6 张图标指标卡、每张目标卡的在线状态 + 丢包 / 成功率圆环、页脚服务状态 + 实时采样柱状 |
| 实时监控 | 指标条 4 张图标卡；表格状态列的图标按真实失败类型切换（正常 → 在线环，DNS → 地球叉号，超时 → 丢包叉号，高延迟 → 波形） |
| 延迟曲线 | 摘要卡图标（当前 / 最大 / 最小 / 范围）+ 实时采样柱状 |
| 国内 / 国外 | 区域大图标（节点颜色由 abnormal 决定）+ 区域丢包 / 在线率圆环 |
| 历史数据 | 概览条 4 张图标卡（目标数 / 平均延迟 / 丢包 / 成功率，均由区间统计重算）+ 卡片标题图标 |
| 目标管理 | 工具条多目标 + 齿轮、地址族列双栈图标、启停列在线图标、小屏提示图标 |
| 设置 | 当前生效配置 6 张图标卡（数值直接读 UCI）+ 服务状态图标 |

### 14.6 自检与实机验证

```sh
# 1) 本地自检：442 条断言，覆盖导出完整性、SVG 结构、尺寸阈值与数据语义
node tests/test_icons.js

# 2) 实机验证：逐页检查图标数量、运行中的动画数量、环形弧长与控制台错误
python3 nm_svg_verify.py
```

实机验证会打印每页的 `icons(svg.nm-svg)` / `animating` 计数与
`stroke-dasharray` 实测值，可直接与上表核对。

---

## 十五、已知限制

1. 探测协议当前实现为 ICMP（`proto` 已预留字段，TCP/HTTP 探测可在后续版本扩展）。
2. `both`（IPv4 + IPv6 同时探测）当前按主地址族执行双栈解析，独立结果展示待后续版本完善。
3. 通知功能仅提供配置位与接口预留，尚未接入具体后端。
4. 目标级检测间隔受全局轮询周期约束，实际间隔为「不小于全局检测间隔」的最接近值。
5. 动态图标中的目标名 / 计数等辅助文字仅在图标渲染尺寸 ≥ 84px 时出现，
   小尺寸下由旁边的文字承担（见 14.4）。

---

## 十六、许可证

GPL-2.0-or-later，详见 `LICENSE`。

