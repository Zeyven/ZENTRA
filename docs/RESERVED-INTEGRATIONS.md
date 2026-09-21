# 外部渠道与设备接口边界

用户已确认支付、团购和实体硬件只预留接口。未接入驱动或服务商的能力返回明确错误，不能模拟支付、核销、打印或读取成功。

商家接口前缀 `/api/merchant/v1`，所有配置由会话确定商家及授权门店。

- `GET /integrations/connections`、`PUT /integrations/connections/:channel`：美团、抖音、微信、小程序的准备配置。启用请求返回 `CHANNEL_NOT_CONNECTED`。签名密钥采用独立认证密钥 AES-256-GCM 加密，AAD 包含商家、门店、渠道，查询只返回配置存在标志，空串保存保留原密钥。没有真实适配器前不分配或宣称支持回调地址。
- `GET /integrations/orders`：仅返回本店已存在渠道订单，可游标分页；不会生成测试订单。
- `POST /integrations/:channel/redeem`：未接入时返回 409，无核销、付款写入。
- `GET /devices`、`PUT /devices/:kind`：小票打印机、手牌读卡器、钱箱、客显屏、房间触控面板（room_panel）的名称、型号与预期连接方式，保存含版本冲突检查。没有驱动绑定时统一 `not_connected`。
- `POST /devices/:kind/test`：409 `DEVICE_NOT_CONNECTED`，不向硬件发送指令。桌面系统打印对话框是现有手动打印能力，与专用硬件驱动接口分开显示。

后续接入必须通过已验证的连接映射、签名和事件幂等确定归属，不信任正文 merchant_id/store_id；不能直接把预留合同当作官方服务商联调完成。支付预约网关配置与预留合同已实现并通过接口验证；本记录不宣称完成服务商联调。

微信、支付宝准备配置使用 `GET /payments/providers` 与 `PUT /payments/providers/:provider`。查询不返回密钥，保存加密后使用独立 AAD；启用及创建支付返回 `PAYMENT_NOT_CONNECTED`。预约支付单、退款单按门店和游标查询，对账只统计真实已落库的支付与退款。

`tests/integrations.test.ts` 3/3 通过，涵盖渠道、支付与设备配置隔离、密钥不回传及未连接拒绝。浏览器设备配置用例已通过；没有实机与官方服务商联调，不以模拟成功替代。

## 2026-09-09 点钟王预留扩展

已在源码增加 room_panel 配置，连接方式可选 unknown（待厂商确认）。每店一份接入准备配置，不是逐台设备注册。GET /devices 和 PUT /devices/room_panel 沿用商家隔离、门店授权、幂等保存和版本冲突检查。POST /devices/room_panel/test 返回 409 ROOM_PANEL_NOT_CONNECTED。未开放设备监听、回调或上下钟执行接口；取得厂商协议后再设计认证、房间绑定和报文适配。

数据库增量迁移 029-room-panel-reservation.sql 只扩展类型约束，保留旧设备配置与 RLS。应用回滚可保留新增约束和配置，不应删除已有配置来回滚。新 API/UI 上线前必须先应用迁移。预留开发阶段先在隔离测试库执行；随后按用户要求以 V1.0.2 发布，见 docs/RELEASE-1.0.2.md。

验证：类型检查、完整构建通过；integrations.test.ts 4/4 通过，覆盖配置落库、跨商家/跨店隔离、篡改归属拒绝、版本冲突及点钟王测试明确拒绝。浏览器设备配置测试 1/1 通过，覆盖小票原配置与点钟王保存、刷新回读及未接入提示。该测试发现并修复首次加载完成前可打开空配置表单的问题：初次读取成功后才允许编辑。没有实机测试。
