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
- 内联动态 SVG 图标：网络脉冲、数据包移动、延迟波纹、在线旋转环、异常告警、跨区连接、丢包消失、高延迟波形
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
└── htdocs/luci-static/resources/
    ├── netmonitor/
    │   ├── style.css                          # 全部样式限定在 .nm- 命名空间
    │   ├── common.js                          # RPC 封装、格式化、等级、卡片
    │   ├── icons.js                           # 内联动态 SVG 图标
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

```bash
opkg update
opkg install luci-app-netmonitor
# 或直接从构建机拷贝 ipk 后安装
# scp luci-app-netmonitor_*.ipk root@192.168.1.1:/tmp/ && ssh root@192.168.1.1 opkg install /tmp/luci-app-netmonitor_*.ipk
```

安装后：

```bash
/etc/init.d/netmonitor enable      # 开机自启
/etc/init.d/netmonitor start
/etc/init.d/netmonitor status
```

浏览器进入 **状态 → 网络质量监控**。

### 5.3 依赖

```
luci-base  luci-mod-status  rpcd  rpcd-mod-ucode
ucode  ucode-mod-fs  ucode-mod-uci  ucode-mod-ubus  ucode-mod-uloop
```

全部为 OpenWrt 主线自带组件，无需额外源。

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

---

## 十三、兼容性

- 目标平台：OpenWrt 主线（23.05 / 24.x 及更新版本），兼容其衍生发行版
- LuCI：现代 JS 视图 + ucode RPC 架构（传统 Lua CBI 版本不适用）
- 探测命令：busybox `ping` / `ping6`，同时兼容 iputils 输出格式
- 主题：仅使用主题提供的 CSS 变量与 `.nm-` 私有命名空间，不影响其它页面

---

## 十四、已知限制

1. 探测协议当前实现为 ICMP（`proto` 已预留字段，TCP/HTTP 探测可在后续版本扩展）。
2. `both`（IPv4 + IPv6 同时探测）当前按主地址族执行双栈解析，独立结果展示待后续版本完善。
3. 通知功能仅提供配置位与接口预留，尚未接入具体后端。
4. 目标级检测间隔受全局轮询周期约束，实际间隔为「不小于全局检测间隔」的最接近值。

---

## 十五、许可证

GPL-2.0-or-later，详见 `LICENSE`。
