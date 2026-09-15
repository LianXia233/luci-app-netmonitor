#
# Copyright (C) 2026 netmonitor contributors
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

# 重要：这里刻意不设置 PKG_NAME。
#
# 本包目录名即 luci-app-netmonitor，luci.mk 会自动推导出同名包：
#     LUCI_NAME?=$(notdir ${CURDIR})
#     PKG_NAME?=$(LUCI_NAME)
#
# 若在此显式设置 PKG_NAME，且构建环境（例如 CI 工作流）恰好导出了同名环境
# 变量 PKG_NAME，OpenWrt 的元数据扫描链路（include/toplevel.mk -> include/scan.mk）
# 会把它原样传进每个包的 DUMP 子 make。luci.mk 用 `PKG_NAME?=$(LUCI_NAME)`
# 推导包名，而 make 把环境变量视为已定义、`?=` 不会覆盖，于是所有 luci 包的
# 包名都被钉成同一个值：tmp/.packageinfo 里出现上百条同名条目（Package 行相同、
# Depends/Submenu 各异），上百个包共用同一个 Kconfig symbol PACKAGE_luci-app-netmonitor，
# 最终 .packagedeps/.config 错乱，package/<name>/compile 目标消失。
# 本仓库曾因此踩坑：CI 工作流定义过 env PKG_NAME=luci-app-netmonitor，已改名。
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

# 不显式设置 LUCI_PKGARCH：luci.mk 的默认值为
#     LUCI_PKGARCH?=$(if $(realpath src/Makefile),,all)
# 本包没有 src/Makefile，默认值即为 all，与显式赋值完全等价，
# 但用 ?= 默认值可避免把该变量强行残留给同批次解析的其它 luci 包。

# 依赖全部是 OpenWrt 主线自带组件，不引入任何大型前端框架或数据库。
#
# 重要：这里刻意不声明 +rpcd / +rpcd-mod-ucode / +ucode。
# luci-base 自身的 LUCI_DEPENDS 已经完整包含这三项：
#   LUCI_DEPENDS:=+rpcd +rpcd-mod-file +rpcd-mod-luci +rpcd-mod-ucode +cgi-io +ucode ...
# 重复声明会在 SDK 环境下触发 Kconfig 递归依赖（recursive dependency detected）：
#   netmonitor -> (select) rpcd <- (select) attendedsysupgrade-common
#   attendedsysupgrade-common 由 SDK 预置的构建期 Kconfig 引入，与本包构成环，
#   导致 `make defconfig` 无法产出 .config，随后 package/<name>/compile 目标不存在。
# 依赖交由 luci-base 传递提供后该环消失。
LUCI_DEPENDS:= \
	+luci-base \
	+luci-mod-status \
	+ucode-mod-fs \
	+ucode-mod-uci \
	+ucode-mod-ubus \
	+ucode-mod-uloop

# 兼容三种常见布局：源码树内 feeds/luci、SDK、以及独立仓库放到 package/ 下。
# 变量名加 NETMONITOR_ 前缀，避免与 luci.mk / feeds 中的同名变量相互干扰。
NETMONITOR_LUCI_MK:=$(firstword $(wildcard \
	$(TOPDIR)/feeds/luci/luci.mk \
	$(TOPDIR)/package/feeds/luci/luci.mk \
	$(TOPDIR)/../feeds/luci/luci.mk))

ifeq ($(NETMONITOR_LUCI_MK),)
$(error Cannot locate luci.mk - please build this package inside an OpenWrt source tree with the LuCI feed installed)
endif

include $(NETMONITOR_LUCI_MK)
