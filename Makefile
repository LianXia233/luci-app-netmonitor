#
# Copyright (C) 2026 netmonitor contributors
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-netmonitor
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-or-later
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=netmonitor contributors

LUCI_TITLE:=Network quality and connectivity monitor (网络质量监控)
LUCI_DESCRIPTION:=Continuous ICMP latency / packet loss / connectivity monitoring \
	for OpenWrt. A procd managed background daemon probes user defined targets on \
	a configurable interval, keeps low-write statistics in tmpfs with optional \
	long term aggregation on flash, and provides a responsive LuCI dashboard \
	(overview, realtime, charts, regions, history, targets, settings) built on \
	native LuCI JS, HTML5, CSS3 and inline SVG.
LUCI_PKGARCH:=all

# 依赖全部是 OpenWrt 主线自带组件，不引入任何大型前端框架或数据库
LUCI_DEPENDS:= \
	+luci-base \
	+luci-mod-status \
	+rpcd \
	+rpcd-mod-ucode \
	+ucode \
	+ucode-mod-fs \
	+ucode-mod-uci \
	+ucode-mod-ubus \
	+ucode-mod-uloop

# 兼容三种常见布局：源码树内 feeds/luci、SDK、以及独立仓库放到 package/ 下
LUCI_MK:=$(firstword $(wildcard \
	$(TOPDIR)/feeds/luci/luci.mk \
	$(TOPDIR)/package/feeds/luci/luci.mk \
	$(TOPDIR)/../feeds/luci/luci.mk))

ifeq ($(LUCI_MK),)
$(error Cannot locate luci.mk - please build this package inside an OpenWrt source tree with the LuCI feed installed)
endif

include $(LUCI_MK)
