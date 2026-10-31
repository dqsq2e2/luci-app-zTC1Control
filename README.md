# luci-app-ztc1Control

zTC1 智能排插的 OpenWrt / LuCI 控制插件。

插件通过局域网 UDP 协议直接与 zTC1 排插通信（默认命令端口 `10182`、上报端口
`10181`），不依赖 Python、Docker、MQTT 或任何云服务。整个软件包为纯脚本实现，
`PKGARCH:=all`，与 CPU 架构无关。

> 协议参考：
> [a2633063/zTC1 通信协议](https://github.com/a2633063/zTC1/wiki/%E9%80%9A%E4%BF%A1%E5%8D%8F%E8%AE%AE) ·
> [SmartControl_Android_MQTT](https://github.com/a2633063/SmartControl_Android_MQTT)

## 功能

- 自动发现与手动扫描局域网内的 zTC1 排插
- 六路插口独立开关，实时显示开关状态
- 显示功率、累计运行时间、固件版本、IP、SSID、在线状态
- 设备与插口重命名（同时写入排插固件，并在 UCI 中保存本地映射）
- 童锁、夜间模式（关闭 LED）
- 设备激活码填写
- 倒计时开关任务（由路由器本地调度）
- 设备原生定时任务（每个插口 5 组，保存在排插内，重启不丢失）
- 服务设置页面：启用/禁用、监听端口、命令端口、广播地址、绑定接口、扫描间隔
- LuCI 原生界面，入口位于 **Control → zTC1**（`/cgi-bin/luci/admin/control/ztc1control`）

## 支持环境

| 项目 | 要求 |
| --- | --- |
| OpenWrt | 24.10 / 25.12 / snapshot（含 ImmortalWrt 等衍生版本） |
| 软件包格式 | `ipk`（opkg）与 `apk` 均已适配 |
| LuCI | JS 版 LuCI（`luci-base`） |
| 架构 | 任意架构（`all` / `noarch`） |
| 依赖 | `ucode`、`ucode-mod-fs`、`ucode-mod-socket`、`ucode-mod-uloop`、`ucode-mod-uci`、`rpcd-mod-ucode`、`jsonfilter`、`luci-base` |

依赖由软件包自动安装，无需手动处理。

## 安装

### 方式一：安装预编译软件包

从 [Releases](https://github.com/dqsq2e2/luci-app-ztc1Control/releases) 下载对应格式的软件包：

```sh
# OpenWrt 24.10（opkg）
opkg install luci-app-ztc1control_*_all.ipk

# OpenWrt 25.12 / snapshot（apk）
apk add --allow-untrusted luci-app-ztc1control-*.apk
```

然后启用服务并刷新 LuCI：

```sh
/etc/init.d/ztc1control enable
/etc/init.d/ztc1control start
```

### 方式二：作为 feed 编译进固件（推荐）

仓库根目录本身就是一个 feed，软件包位于 `luci-app-ztc1control/` 子目录。

使用 Git 源：

```sh
cd openwrt
echo "src-git ztc1control https://github.com/dqsq2e2/luci-app-ztc1Control.git" >> feeds.conf.default
./scripts/feeds update ztc1control
./scripts/feeds install -a -p ztc1control
```

或者使用本地目录：

```sh
cd openwrt
echo "src-link ztc1control /path/to/luci-app-ztc1Control" >> feeds.conf.default
./scripts/feeds update ztc1control
./scripts/feeds install -a -p ztc1control
```

然后在 `make menuconfig` 中选中：

```text
LuCI
  └── Applications
        └── <*> luci-app-ztc1control
```

最后正常编译固件即可，软件包会随固件一起生成。

### 方式三：直接复制到 buildroot

```sh
cp -r luci-app-ztc1Control/luci-app-ztc1control /path/to/openwrt/package/
```

之后同样在 `menuconfig` 中选中即可。

## 使用

1. 确认 zTC1 排插与路由器处于同一局域网，且手机 App 已为排插配网。
2. 打开 LuCI：**Control → zTC1**。
3. 点击「扫描设备」，等待排插上报告。
4. 使用每路插口右侧的按钮开关；使用设备下方的按钮进行重命名、激活、童锁、
   倒计时和定时任务设置。

> 重命名会把新名称通过 UDP 写入排插：设备名称最多 32 个 UTF-8 字节（约 10 个
> 汉字），插口名称最多 16 个字符；同时保存到 `/etc/config/ztc1control` 作为本地
> 映射。设备在线时以排插上报的名称为准，本地映射只用于离线显示或发送失败时的
> 回退。名称留空时只保存到本地，不会改动排插中的名称。

## 配置

配置文件：`/etc/config/ztc1control`

```uci
config ztc1control 'main'
	option enabled '1'          # 是否启用后台服务
	option listen_port '10181'   # 接收排插上报的 UDP 端口
	option command_port '10182'  # 向排插发送命令的 UDP 端口
	option broadcast 'auto'      # auto 或定向广播地址，如 192.168.1.255
	option bind_interface 'auto' # auto 使用 lan 接口，none 不绑定，或指定设备名
	option scan_interval '60'    # 自动扫描间隔（秒），0 表示关闭自动扫描
```

配置也可以直接在同页面的「服务设置」中修改，点击「保存并应用」后服务会自动重启。

### 命令行

插件提供了 `ztc1ctl` 命令，便于脚本调用：

```sh
ztc1ctl scan
ztc1ctl plug <mac> <0-5> <0|1>
ztc1ctl query <mac>
ztc1ctl locks <mac> <0|1> <0|1>
ztc1ctl activate <mac> <激活码>
ztc1ctl rename <mac> <设备名> <插口1> <插口2> <插口3> <插口4> <插口5> <插口6>
ztc1ctl timer <mac> <插口> <任务> <时> <分> <重复位图> <动作> <启用>
ztc1ctl countdown <mac> <插口> <秒数> <动作>
```

示例：关闭 MAC 为 `001122334455` 的排插第 3 路插口：

```sh
ztc1ctl plug 001122334455 2 0
```

## 实现说明

```text
luci-app-ztc1control/
├── Makefile
├── htdocs/luci-static/resources/view/ztc1control/   # LuCI JS 界面
├── root/etc/config/ztc1control                      # UCI 配置
├── root/etc/init.d/ztc1control                      # procd 服务
├── root/usr/bin/ztc1ctl                             # 命令行封装
├── root/usr/share/ztc1/ztc1d.uc                     # UDP 后台守护进程（ucode）
├── root/usr/share/ztc1/ztc1ctl.uc                   # 命令实现（ucode）
├── root/usr/share/rpcd/ucode/luci.ztc1control       # rpcd 后端（ubus 对象）
├── root/usr/share/luci/menu.d/                      # 菜单（Control → zTC1）
├── root/usr/share/rpcd/acl.d/                       # 权限
└── root/usr/share/ucitrack/                         # 配置变更后自动重启服务
```

- 后台守护进程使用 `ucode` + `uloop` 监听 UDP，并把设备状态写入
  `/var/run/ztc1/state.json`；该文件位于内存文件系统，重启后由扫描重新建立。
- 前端通过 `luci.ztc1control` 这个 ubus 对象与后端通信，所有写操作都有 CSRF 与
  ACL 保护。
- 倒计时任务以文件形式存放在 `/var/run/ztc1/countdown/`，由守护进程到期执行；
  路由器重启会丢失未到期的倒计时（设备原生定时任务不受影响）。
- 广播地址默认根据 `lan` 接口的地址与掩码自动计算，避免多网口路由器把广播发到
  WAN 口。

## 自动编译与发布

GitHub Actions 会在以下场景自动构建：

- push 到 `main`：构建 `ipk`、`apk`，上传 Actions Artifacts，并创建/更新
  `latest` Release（便于直接下载安装）
- Pull Request：仅构建并上传 Artifacts
- 推送 `v*` 标签：构建并创建对应版本号的 GitHub Release

构建矩阵：

| 目标 | SDK 镜像 | 产物 |
| --- | --- | --- |
| OpenWrt 24.10 | `x86_64-openwrt-24.10` | `luci-app-ztc1control_*_all.ipk` |
| OpenWrt 25.12 | `x86_64-openwrt-25.12` | `.apk`（`noarch`） |

由于软件包为 `all` 架构，任一架构构建出的包均可安装到所有目标设备。

本地编译验证：

```sh
make package/luci-app-ztc1control/compile V=s
```

## 与原项目的关系

本仓库是原 Docker/Python 版局域网控制服务的 OpenWrt 移植版本。原始项目
（`app.py`、Web 管理页面与 HTTP API）仍保留在
[dqsq2e2/zTC1](https://github.com/dqsq2e2/zTC1)，本仓库只包含 OpenWrt 插件。

## 许可证

[MIT](LICENSE)
