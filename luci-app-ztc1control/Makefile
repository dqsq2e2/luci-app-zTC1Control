# Copyright (C) 2026 dqsq2e2
#
# This is free software, licensed under the MIT License.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ztc1control
PKG_VERSION:=1.0.2
PKG_RELEASE:=2
PKG_LICENSE:=MIT

LUCI_TITLE:=LuCI support for zTC1 smart power strips
LUCI_DESCRIPTION:=Discover and control zTC1 Wi-Fi power strips over the local network (UDP 10182/10181).
LUCI_DEPENDS:=+luci-base +ucode +ucode-mod-fs +ucode-mod-socket +ucode-mod-uloop \
	+ucode-mod-uci +rpcd-mod-ucode +jsonfilter +uhttpd
LUCI_PKGARCH:=all
LUCI_MAINTAINER:=dqsq2e2
LUCI_URL:=https://github.com/dqsq2e2/luci-app-zTC1Control

define Package/$(PKG_NAME)/conffiles
/etc/config/ztc1control
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/ztc1control enable 2>/dev/null
	/etc/init.d/ztc1control start 2>/dev/null
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
}
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/ztc1control stop 2>/dev/null
	/etc/init.d/ztc1control disable 2>/dev/null
}
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
