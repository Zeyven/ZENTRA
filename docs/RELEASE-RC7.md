# 1.0.0-rc.7 登录入口切换（2026-09-09）

商家登录页右上角增加“商家登录 / 平台登录”分段入口。网页跳转 /platform，平台页面原有“返回商家登录”可返回。未提交的密码不随导航传递，账号和会话仍分离。390px 窄屏显示验证通过。

Windows 点击平台登录，通过受信任主窗口 IPC 请求主进程在浏览器打开固定 https://saas.zephael.cn/platform。接口不接受目标 URL 或凭证参数，不放开客户端的平台网络请求与导航限制。浏览器启动失败时显示明确地址和错误反馈。使用 Electron shell.openExternal，官方接口说明：https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options 。

类型检查、contracts/server/Web/Electron 构建、NSIS 打包和 29 项包内文件一致性校验通过。3 项浏览器/真实 Electron 测试通过：网页往返及输入隔离、窄屏入口、桌面真实 IPC 路径与既有网络拦截、商家登录与现金结账。自动化仅截获 OS 浏览器启动边界核对固定地址，未实际验证系统默认浏览器启动，也未重新执行安装后的运行验收。

安装包 112950619 字节，SHA-256 69968c022d70c565e721238ea3145d0f98f07fa2242438966b6fa15987ed4fe8。云端激活目录 20260909T012606Z，新 API rc.7 与旧服务健康，配额不变，无数据库迁移；旧项目 93 项源文件哈希不变。生产网页入口点击和返回已通过，公开 HTML 与当前构建一致，无生产业务数据修改。

Windows rc.7 安装包、blockmap 已上传校验，最后替换 rc 清单；公开 HTTPS 清单版本、安装包状态及大小核对通过。
