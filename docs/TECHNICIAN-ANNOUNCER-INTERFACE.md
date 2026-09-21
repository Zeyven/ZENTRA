# 技师房叫号播报器：配置接口预留

## 当前实现

入口：钟房排钟 → 技师房播报器；门店设置 → 设备接口。两处读写同一份本店配置。

设备类型 `technician_announcer`，与房间触控面板 `room_panel` 独立。一店预留一份终端或网关配置。字段包括品牌型号、预期连接方式、协议、主机/IP/串口名、端口、终端编号、区域、文案、音量、重复次数、预期触发方式。协议选项仅供记录厂家信息，不表示已实现 TCP、UDP、HTTP 或 MQTT 适配。

当前状态固定为 `not_connected`。保存触发方式不启用自动播报；现有钟房叫钟使用当前电脑语音，无法证明远端硬件已播出。配置不包含认证密码或密钥，不向填写的地址发起网络请求。

## 商家 API

请求使用已登录商家会话的 `Authorization: Bearer …` 和已授权门店 `X-Store-ID`。平台凭证不能使用。需老板，或有钟房/门店设置页面权限的店长；写入另需 `settingsManage`。配置支持授权沿用现有只读/维护限制；支持人员不能测试发送硬件指令。

- `GET /api/merchant/v1/devices/technician_announcer`：返回 `{connection: 配置或null, status: 'not_connected'}`。
- `PUT /api/merchant/v1/devices/technician_announcer`：保存草稿。必须提供 `Idempotency-Key`、当前 `version`（首次为0）；版本不匹配409，重复原请求只保存一次。
- `POST /api/merchant/v1/devices/technician_announcer/test`：返回409 `ANNOUNCER_NOT_CONNECTED`，不发送设备命令。

PUT 示例：

```json
{
  "version": 0,
  "name": "技师房播报器",
  "model": "待厂家确认",
  "transport": "network",
  "announcer_config": {
    "protocol": "unknown",
    "address": "192.168.1.50",
    "port": null,
    "terminal_id": "",
    "zone": "技师房",
    "template": "{technician_code}号技师，请到{room_no}房间上钟",
    "repeats": 1,
    "volume": 70,
    "triggers": ["manual_call", "assigned", "reassigned"]
  }
}
```

端口1–65535或留空；重复1–3次；音量0–100；文案最长300字符，仅支持技师编号与房间号占位符。`announcer_config` 省略时保留已有配置。多端配置使用版本冲突检测和 `device.technician_announcer` 事件；不会覆盖正在编辑的草稿。

## 后续实机接入需要

厂家/型号/固件版本，局域网拓扑和连接方式，正式协议或SDK、认证方式、播报命令与回执样例、字符编码、终端/分区规则，以及可联调设备。不能将私有协议仅凭“TCP/IP”视为已知。

取得协议后实现门店网关/驱动、派钟事务提交后的任务投递、原请求去重、过期消息丢弃、回执和失败反馈。云端不能直接访问门店私网地址；需要门店侧连接组件或厂家云接口。播报故障不应回滚已经成功的派钟订单。自动播报、重播命令、多终端分区控制和真实硬件验收均未在本次配置预留中实现。

## 数据库与上线

迁移031增加设备类型和 nullable JSONB 配置列，沿用门店复合外键、强制 RLS、审计及权限校验，不修改原有业务数据。2026-09-09 已备份生产数据库并应用031，云端版本已发布为1.0.7。发布目录 `/opt/za-spa-saas/releases/20260909T091340Z`，API就绪检查、平台6个工作区检查通过；原有服务状态和资源限额保持不变。

本次使用递增版本1.0.7，不覆盖已发布的1.0.6安装包。类型检查、服务端/Web/Electron构建通过；发布前3项浏览器/桌面测试通过，覆盖桌面身份隔离与启动、真实收银、播报配置保存与回显。安装包31个内置文件与构建输出一致。

接口回归5项通过，覆盖现有设备/点钟王/渠道接口，以及新增播报草稿的商家门店隔离、重复请求去重、版本冲突、非法字段与参数拒绝、旧客户端省略配置的兼容、店长钟房独立授权、撤销写入权限和配置事件可见性。

迁移前备份：`za_spa_saas-20260909T091311Z-47baf5ce.dump`，SHA256 `c22f24fcd41c149a94fc63a5ffc583b2c1fe2d36483bfca51acde1c221ff950d`。本轮未重复执行覆盖安装测试；真实播报器仍待厂商协议与实机联调。

1.0.7 Windows stable/rc更新渠道及网页下载入口已发布。2026-09-09 09:17:20 UTC完整下载校验通过：112956108字节，SHA256 `955bcd35f3354e19b89b38228227340c4237caf38d92299b14c90e1342c26e29`。公开ClockRoom、Settings、TechnicianAnnouncer资源与本地构建逐字节一致；未登录访问配置接口返回401。
