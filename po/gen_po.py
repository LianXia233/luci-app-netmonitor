#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 luci-app-netmonitor 的 po 模板与中文翻译文件。

用法：python3 po/gen_po.py
输出：po/templates/luci-app-netmonitor.pot
      po/zh_Hans/luci-app-netmonitor.po

说明：
  * 本脚本从 htdocs 下的 JS 源码与 menu.d JSON 中提取 _('...') 字面量，
    与下面的译文字典合并后输出，避免手工维护时漏翻。
  * 未收录的字符串会以空 msgstr 输出并打印告警，方便补齐。
"""

import io
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(BASE, 'htdocs', 'luci-static', 'resources')
MENU = os.path.join(BASE, 'root', 'usr', 'share', 'luci', 'menu.d', 'luci-app-netmonitor.json')

DOMAIN = 'luci-app-netmonitor'

ZH = {
    # 菜单
    'Network Monitor': '网络质量监控',
    'Overview': '总览',
    'Realtime': '实时监控',
    'Latency Charts': '延迟曲线',
    'CN / Global': '国内 / 国外',
    'History': '历史数据',
    'Targets': '目标管理',
    'Settings': '设置',

    # 通用 / 状态
    'Never': '从未',
    'Just now': '刚刚',
    'China': '国内',
    'Overseas': '国外',
    'Other': '其他',
    'Timeout': '超时',
    'DNS resolve failed': 'DNS 解析失败',
    'Network unreachable': '网络不可达',
    'Invalid target': '目标无效',
    'Check failed': '检测失败',
    'Avg': '平均',
    'Average': '平均',
    'P50': 'P50',
    'P95': 'P95',
    'Loss': '丢包',
    'Uptime': '在线率',
    'Current': '当前',
    'Max': '最大',
    'Min': '最小',
    'Range': '范围',
    'Online': '在线',
    'Abnormal': '异常',
    'Failed': '失败',
    'Disabled': '已禁用',
    'Total': '总数',
    'Samples': '样本数',
    'Statistics': '统计',
    'Updated': '更新时间',
    'Interval': '检测间隔',
    'UI refresh': '界面刷新',
    'Actions': '操作',

    # 等级
    'Excellent': '优秀',
    'Good': '良好',
    'Fair': '一般',
    'Poor': '较差',
    'Severe': '严重',
    'Offline': '离线',
    'Unknown': '未知',

    # 相对时间
    '%d seconds ago': '%d 秒前',
    '%d minutes ago': '%d 分钟前',
    '%d hours ago': '%d 小时前',
    '%d days ago': '%d 天前',

    # 时间范围
    '1 min': '最近 1 分钟',
    '5 min': '最近 5 分钟',
    '15 min': '最近 15 分钟',
    '30 min': '最近 30 分钟',
    '1 hour': '最近 1 小时',
    '6 hours': '最近 6 小时',
    '12 hours': '最近 12 小时',
    '24 hours': '最近 24 小时',
    '3 days': '最近 3 天',
    '7 days': '最近 7 天',
    '30 days': '最近 30 天',

    # 总览
    'No monitoring data': '暂无监控数据',
    'Add and enable monitoring targets to start collecting data.': '请添加并启用监控目标以开始采集数据。',
    'Network is healthy': '网络正常',
    'All monitored targets respond normally.': '所有监控目标响应正常。',
    'Network problems detected': '网络存在异常',
    'Some targets are unreachable or unstable.': '部分目标不可达或不稳定。',
    'Serious network failure': '网络严重故障',
    'One or more targets failed consecutively beyond the threshold.': '一个或多个目标连续失败次数已超过阈值。',
    'Current latency': '当前延迟',
    'Packet loss': '丢包率',
    'Targets': '目标数',
    'Background service is not running. Monitoring is stopped.': '后台服务未运行，监控已停止。',
    'Background service did not update data recently. Check the service status.': '后台服务近期未更新数据，请检查服务状态。',
    'No enabled targets. Go to Targets to add one.': '没有已启用的目标，请到「目标管理」添加。',
    'Average latency': '平均延迟',
    'Across enabled targets': '所有已启用目标的平均值',
    'Latest probe round': '最近一次检测结果',
    'Weighted by samples': '按样本加权',
    'China network': '国内网络',
    'Overseas network': '国外网络',
    'Online targets': '在线目标',
    'Target count': '目标数',
    'No targets configured': '尚未配置监控目标',
    'Service running': '服务运行中',
    'Service stopped': '服务已停止',
    'Last update': '最后更新',
    'Operation completed': '操作已完成',
    'Start': '启动',
    'Stop': '停止',
    'Restart': '重启',

    # 动态 SVG 图标卡片
    'Success rate': '成功率',
    'Samples': '样本数',
    'Probe settings': '探测设置',
    'Check interval': '检测间隔',
    'Probe timeout': '探测超时',
    'Data source': '数据来源',
    'In-memory ring buffer': '内存环形缓存',
    'Retention': '保留期',
    'Dual stack': '双协议栈',
    'Address family': '地址族',
    'Live sampling': '实时采样',
    'Selected targets': '已选目标',
    'Master switch': '总开关',
    'Reserved': '预留',
    'UI refresh interval': '界面刷新间隔',
    'Independent from the probe interval': '与探测间隔相互独立',
    'The table scrolls horizontally on small screens.': '小屏幕下表格可横向滚动。',

    # 实时监控
    'All regions': '所有区域',
    'All status': '所有状态',
    'Region': '区域',
    'Status': '状态',
    'Search name or address': '搜索名称或地址',
    'Search': '搜索',
    'Pause': '暂停',
    'Resume': '继续',
    'Name': '名称',
    'Address': '地址',
    'Fails': '连续失败',
    'Last check': '最后检测',
    'No matching targets': '没有匹配的目标',

    # 曲线
    'Time range': '时间范围',
    'All targets': '所有目标',
    'Quick filter': '快速筛选',
    'No target selected': '未选择目标',
    'Data source: persistent history on flash': '数据来源：Flash 持久化历史',
    'Data source: in-memory ring buffer': '数据来源：内存环形缓存',
    'Latency trend': '延迟趋势',
    'No data in this range': '该时间范围内没有数据',
    'Target': '目标',
    'Query': '查询',
    'History persistence is disabled. Ranges longer than the in-memory buffer may have no data.':
        '历史持久化未启用，超出内存缓存范围的时间段可能没有数据。',

    # 区域
    'Region latency comparison': '区域延迟对比',
    'No targets': '暂无目标',

    # 设置
    'Checking...': '正在检查…',
    'Clear all collected samples and persistent history': '清空所有已采集样本与持久化历史',
    'Clear history': '清空历史',
    'Clear all collected history data?': '确定清空所有历史数据？',
    'History cleared': '历史数据已清空',
    'Global settings': '全局设置',
    'Detection': '检测设置',
    'Enable monitoring': '启用监控',
    'Master switch. When disabled the background daemon stops probing.': '总开关。关闭后后台服务停止探测。',
    'Check interval (seconds)': '检测间隔（秒）',
    'Recommended values: 1, 5, 10, 15, 30, 60, 120, 300. Allowed range 1-3600.':
        '推荐值：1、5、10、15、30、60、120、300。允许范围 1-3600。',
    'Probe timeout (seconds)': 'Ping 超时（秒）',
    'Per-packet wait time before a probe is considered lost.': '单个探测包的等待时间，超时即判定为丢包。',
    'Packets per probe': '每次检测发包数',
    'Higher values give better loss statistics but cost more time.': '数值越大丢包统计越准，但耗时更长。',
    'Concurrent probes': '并发检测数量',
    'Maximum number of targets probed in parallel.': '同时进行探测的目标数量上限。',
    'Address family': '地址族',
    'Auto': '自动',
    'IPv4 only': '仅 IPv4',
    'IPv6 only': '仅 IPv6',
    'Outbound interface (optional)': '出口接口（可选）',
    'Example: wan, wwan. Leave empty to use the system default route.':
        '例如 wan、wwan。留空则使用系统默认路由。',
    'auto': '自动',
    'Source address (optional)': '源地址（可选）',
    'Bind probes to a specific source IP address.': '将探测绑定到指定的源 IP 地址。',
    'Data retention': '数据保留',
    'Persistent history': '历史持久化',
    'Write aggregated samples to flash periodically. Disabled by default to protect flash lifetime.':
        '定期将聚合数据写入 Flash。默认关闭以保护 Flash 寿命。',
    'History retention': '历史保留时间',
    'Flush interval (seconds)': '落盘间隔（秒）',
    'How often aggregated data is written to flash. Larger values mean fewer writes.':
        '聚合数据写入 Flash 的频率，数值越大写入次数越少。',
    'In-memory samples per target': '每目标内存采样点数',
    'Ring buffer size in /tmp. 4320 samples at 10s interval covers about 12 hours.':
        '/tmp 中环形缓存的大小。10 秒间隔下 4320 点约覆盖 12 小时。',
    'Thresholds': '阈值',
    'Excellent below (ms)': '优秀（低于，毫秒）',
    'Good below (ms)': '良好（低于，毫秒）',
    'Fair below (ms)': '一般（低于，毫秒）',
    'Poor below (ms)': '较差（低于，毫秒）',
    'Loss warning (%)': '丢包告警阈值（%）',
    'Loss critical (%)': '丢包严重阈值（%）',
    'Consecutive failures to warn': '连续失败告警阈值',
    'Consecutive failures to critical': '连续失败严重阈值',
    'Interface & logging': '界面与日志',
    'UI refresh interval (seconds)': '界面刷新间隔（秒）',
    'How often the page fetches new state. Independent from the probe interval.':
        '页面获取最新状态的频率，与检测间隔相互独立。',
    'Log level': '日志级别',
    'Normal probes are never logged. Only state changes and failures produce log entries.':
        '正常探测不写日志，只在状态变化和失败时记录。',
    'Debug': '调试',
    'Info': '信息',
    'Warning': '警告',
    'Error': '错误',
    'Notification (reserved)': '通知（预留）',
    'Enable notification': '启用通知',
    'Interface is reserved for future webhook / Telegram / WeCom / DingTalk / mail support.':
        '接口预留，后续可扩展 Webhook、Telegram、企业微信、钉钉、邮件等方式。',
    'Notification endpoint': '通知地址',
    'Reserved. Leave empty until a notification backend is available.':
        '预留项，在通知后端可用之前请留空。',

    # 目标管理
    'Add target': '新增目标',
    'Enable selected': '批量启用',
    'Disable selected': '批量禁用',
    'Refresh': '刷新',
    'Global interval': '全局间隔',
    'Timeout': '超时',
    'Label': '标签',
    'Family': '地址族',
    'Interface': '接口',
    'Enabled': '启用',
    'Interval and timeout set to 0 inherit the global settings.': '间隔与超时填 0 表示继承全局设置。',
    'IPv4': 'IPv4',
    'IPv6': 'IPv6',
    'IPv4 + IPv6': 'IPv4 + IPv6',
    'Global': '跟随全局',
    'Edit': '编辑',
    'Copy': '复制',
    'Delete': '删除',
    'Delete this target?': '确定删除该目标？',
    'Edit target': '编辑目标',
    'Custom label': '自定义标签',
    'Check interval (s, 0 = global)': '检测间隔（秒，0 = 跟随全局）',
    'Timeout (s, 0 = global)': '超时（秒，0 = 跟随全局）',
    'Interface (optional)': '接口（可选）',
    'Source address (optional)': '源地址（可选）',
    'Remark': '备注',
    'Cancel': '取消',
    'Save': '保存',
    'Name and address are required': '名称与地址为必填项',
    'Saved': '已保存',
}

# 手工补充（来自数组常量 / 动态拼接，正则无法直接提取）
EXTRA = [
    'Excellent', 'Good', 'Fair', 'Poor', 'Severe', 'Offline', 'Unknown',
    '%d seconds ago', '%d minutes ago', '%d hours ago', '%d days ago',
    '1 min', '5 min', '15 min', '30 min', '1 hour', '6 hours', '12 hours',
    '24 hours', '3 days', '7 days', '30 days',
    '1 hour', '6 hours', '12 hours', '24 hours', '3 days', '7 days', '30 days',
]

PAT = re.compile(r"_\('((?:[^'\\]|\\.)*)'\)")


def collect():
    strings = []
    seen = set()

    def add(s):
        if s and s not in seen:
            seen.add(s)
            strings.append(s)

    for dirpath, _dirnames, filenames in os.walk(RES):
        for fn in sorted(filenames):
            if not fn.endswith('.js'):
                continue
            with io.open(os.path.join(dirpath, fn), encoding='utf-8') as fh:
                src = fh.read()
            for m in PAT.finditer(src):
                add(m.group(1).replace("\\'", "'"))

    # 菜单 JSON 中的 title
    if os.path.isfile(MENU):
        import json
        with io.open(MENU, encoding='utf-8') as fh:
            data = json.load(fh)
        for _key, node in data.items():
            add(node.get('title'))

    for s in EXTRA:
        add(s)

    return strings


def escape(v):
    return v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def write_po(path, strings, translated):
    header = (
        '# luci-app-netmonitor translation file\n'
        '# Copyright (C) 2026 netmonitor contributors\n'
        '# This file is distributed under the same license as the luci-app-netmonitor package.\n'
        '#\n'
        'msgid ""\n'
        'msgstr ""\n'
        '"Project-Id-Version: luci-app-netmonitor 1.0.0\\n"\n'
        '"Language: %s\\n"\n'
        '"MIME-Version: 1.0\\n"\n'
        '"Content-Type: text/plain; charset=UTF-8\\n"\n'
        '"Content-Transfer-Encoding: 8bit\\n"\n'
        '"X-Generator: po/gen_po.py\\n"\n'
        % (translated and 'zh_Hans' or 'en')
    )

    out = [header]
    for s in strings:
        msgstr = ZH.get(s, '') if translated else ''
        out.append('')
        out.append('msgid "%s"' % escape(s))
        out.append('msgstr "%s"' % escape(msgstr))

    with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(out) + '\n')


def main():
    strings = collect()
    missing = [s for s in strings if s not in ZH]

    pot = os.path.join(BASE, 'po', 'templates', DOMAIN + '.pot')
    po = os.path.join(BASE, 'po', 'zh_Hans', DOMAIN + '.po')

    write_po(pot, strings, False)
    write_po(po, strings, True)

    sys.stdout.write('strings: %d, untranslated: %d\n' % (len(strings), len(missing)))
    for s in missing:
        sys.stdout.write('  MISSING: %s\n' % s)
    return 0


if __name__ == '__main__':
    sys.exit(main())
