# zTC1 HTTP API

`luci-app-ztc1control` 内置一个独立的 HTTP API，供脚本、Home Assistant、Node-RED
等外部程序调用。API 由 uhttpd 提供，监听单独的端口，和 LuCI 管理页面互不影响。

## 启用与配置

在 LuCI 的 **Control → zTC1 → Settings** 页面中配置，或直接修改
`/etc/config/ztc1control`：

```uci
config ztc1control 'main'
	option api_enabled '1'   # 是否启用 HTTP API
	option api_port '8091'   # API 监听端口
	option api_key ''        # 为空时服务启动会自动生成 32 位十六进制 key
```

修改后点击“保存并应用”，服务会自动重启。

查看当前 key：

```sh
uci get ztc1control.main.api_key
```

> API 默认监听 `0.0.0.0:8091`，请只在局域网内使用；不要在没有防火墙保护的情况下
> 把该端口暴露到公网。所有接口都必须携带 API Key。

## 认证

每个请求都必须携带 API Key：

```http
Authorization: Bearer <api_key>
```


缺少或错误的 key 会返回 `401 Unauthorized`。uhttpd 只转发标准请求头，因此请使用 `Authorization: Bearer`；如果前面还有反向代理，也可以让它转发 `X-API-Key`。

## 基础地址

```text
http://<路由器地址>:<api_port>/api
```

例如 `http://192.168.1.1:8091/api`。

所有响应都是 UTF-8 JSON，成功时包含 `"ok": true`，失败时包含
`"ok": false` 和 `"error"` 字段。

## 接口列表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/info` | 服务信息与设备数量 |
| GET | `/api/devices` | 所有已发现设备及状态 |
| GET | `/api/devices/<mac>` | 单个设备状态 |
| POST | `/api/scan` | 发送局域网扫描广播 |
| POST | `/api/devices/<mac>/query` | 主动向设备查询最新状态 |
| POST | `/api/devices/<mac>/control` | 开关插口、童锁、夜间模式、激活 |
| POST | `/api/devices/<mac>/rename` | 修改设备名和插口名（同时写入排插） |
| POST | `/api/devices/<mac>/countdown` | 创建本地倒计时任务 |
| POST | `/api/devices/<mac>/timer` | 设置排插原生定时任务 |
| GET | `/api/countdowns` | 列出未到期的倒计时任务 |
| DELETE | `/api/countdowns/<id>` | 取消倒计时任务 |

`<mac>` 为 12 位十六进制 MAC，大小写均可，可以带冒号或短横线。

## 示例

### 服务信息

```sh
curl -H "Authorization: Bearer $KEY" http://192.168.1.1:8091/api/info
```

```json
{
  "ok": true,
  "name": "luci-app-ztc1control",
  "version": "1.0.1",
  "api_port": 8091,
  "listen_port": 10181,
  "command_port": 10182,
  "updated": 1700000000,
  "device_count": 1
}
```

### 设备列表

```sh
curl -H "Authorization: Bearer $KEY" http://192.168.1.1:8091/api/devices
```

```json
{
  "ok": true,
  "updated": 1700000000,
  "devices": [
    {
      "mac": "001122334455",
      "device_name": "zTC1_Sequence",
      "ip": "192.168.1.145",
      "ssid": "home",
      "version": "v1.3.3",
      "power": "13.3",
      "total_time": 1402920,
      "child_lock": 0,
      "led_lock": 0,
      "lock_state": false,
      "last_seen": 1700000000,
      "online": true,
      "plugs": [
        { "index": 0, "name": "电视", "on": 1 },
        { "index": 1, "name": "路由", "on": 0 }
      ]
    }
  ]
}
```

- `power`：当前功率（字符串，单位 W）
- `total_time`：累计运行时间（分钟）
- `online`：最近 120 秒内是否收到过设备上报
- `plugs[].on`：`1` 开、`0` 关、`-1` 未知

### 开关插口与童锁

```sh
curl -X POST http://192.168.1.1:8091/api/devices/001122334455/control \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plug_0": { "on": 1 },
    "plug_1": { "on": 0 },
    "child_lock": 1,
    "led_lock": 0
  }'
```

响应：

```json
{
  "ok": true,
  "mac": "001122334455",
  "results": [
    { "ok": true, "code": 0, "output": "{\"ok\":true}" }
  ]
}
```

`child_lock` / `led_lock` 只传一个时，另一个保持设备当前状态。也可以传
`"lock": "激活码"` 发送激活命令。

### 重命名

```sh
curl -X POST http://192.168.1.1:8091/api/devices/001122334455/rename \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "客厅排插",
    "plugs": ["电视", "路由器", "", "", "", ""]
  }'
```

- 设备名最多 32 个 UTF-8 字节；插口名最多 16 个字符
- 名称会写入排插，并同时保存到 `/etc/config/ztc1control`
- 空名称只保存到本地，不会改动排插中的名称
- 响应中的 `sent` 是实际发送到排插的 UDP 命令数量

### 倒计时

```sh
curl -X POST http://192.168.1.1:8091/api/devices/001122334455/countdown \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "plug": 0, "seconds": 600, "action": 1 }'
```

- `action`：`1` 表示到点开启，`0` 表示到点关闭
- 倒计时由路由器本地调度，路由器重启会丢失未到期任务

### 原生定时任务

```sh
curl -X POST http://192.168.1.1:8091/api/devices/001122334455/timer \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plug": 0,
    "task": 0,
    "hour": 7,
    "minute": 30,
    "repeat": 127,
    "action": 1,
    "enable": 1
  }'
```

- `task`：`0`–`4`，每个插口有 5 组定时任务
- `repeat`：星期位图，bit0=周一 … bit6=周日，`127` 表示每天
- `action`：`1` 开、`0` 关；`enable`：`1` 启用、`0` 禁用
- 定时任务保存在排插内，重启不丢失

### 倒计时列表与取消

```sh
curl -H "Authorization: Bearer $KEY" http://192.168.1.1:8091/api/countdowns
curl -X DELETE -H "Authorization: Bearer $KEY" \
  http://192.168.1.1:8091/api/countdowns/1700000123-job.json
```

## 错误码

| 状态码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 400 | 参数或 JSON 格式错误 |
| 401 | API Key 缺失或错误 |
| 404 | 设备或任务不存在 |
| 502 | 命令发送失败（设备离线、端口错误等） |
| 503 | API Key 尚未生成，重启服务即可 |

## 安全建议

- 只允许局域网访问 API 端口，默认防火墙会丢弃来自 WAN 的入站连接。
- 定期更换 `api_key`；更换后所有旧客户端需要同步更新。
- 不要把 API Key 写进公开的脚本或仓库。
