# 思软／康康驾到硬件公开资料检索

核查日期：2026-09-14。范围：公开官网、官方链接资料网盘、GitHub仓库、搜索引擎索引、公开Web应用静态文件。未登录厂商系统，未使用用户提供的Session，未调用设备控制或业务接口，未运行下载的APK。

## 结论

找到旧版点钟王Android安装包、官网共享资料目录中的施工规范，以及康康驾到Web客户端实际使用的硬件配置接口名称。**尚未找到能够直接接入现场7寸面板的完整公开通信协议／SDK／Thrift IDL，也未找到与现场钟房机顶盒对应的应用包和播报协议。**

“未找到”仅表示本次检索结果，不能推断厂家一定没有协议或不提供授权。

## 1. 官网资料库：已确认目录，未取得文档正文

- 官方入口：https://www.eissoft.com/xiazai/
- 官网链接的公开资料分享：https://pan.baidu.com/s/1jG4305C
- 共享目录：`思软足浴桑拿软件 / 用户手册`
- 发现文件：`7寸平板点钟王施工标准规范（2019版）.doc`，944640字节。
- 同目录包含用户操作手册、连锁手册、中间件升级操作说明及酒店接口说明。
- 门锁柜锁接口、酒店餐饮接口、视频学习这三个顶层目录本次列表为空；不能据目录标题认定协议已公开。
- 用户手册下酒店接口说明包含奥普、迪联、好食好客、九星的配置说明；不是点钟王底层通信协议。

使用公开分享页面的访客会话读取目录成功；未取得上述Word文件正文。浏览器自动化服务当前不可用，因此没有完成浏览器下载。不能凭文件名声称已读到协议。

## 2. GitHub旧版Android资料：已下载并静态检查

- 仓库：https://github.com/eissoft/eissoft.github.io
- 发布页：https://github.com/eissoft/eissoft.github.io/blob/master/index.html
- 域名映射：https://github.com/eissoft/eissoft.github.io/blob/master/CNAME
- CNAME内容指向`apk.eissoft.com`；发布页标记思软软件并链接`www.eissoft.com`。属于强关联证据，但不等于已向厂家确认当前维护状态。
- 仓库最近提交时间：2020-05-29；本次`https://apk.eissoft.com`请求返回404。
- 包：https://github.com/eissoft/eissoft.github.io/blob/master/eissoftclock_2.0.7.apk
- 大小：27241344字节。
- SHA256：`1dc71a9598147ea576576556d7f5757313fd52189c4b0baf140cb607f245ccae`
- 本地隔离分析文件：`.runtime/eissoftclock_2.0.7.apk`，不进入应用构建。
- DEX存在`com.eissoft.android.clockking`包标识、HTTP库、串口库、语音相关库与点钟王界面标识。
- DEX字符串未发现`Thrift`、`OnAskCall`、`OnAnsweCall`、`SystemDeviceLogin`。这不是“不使用Thrift”的完整证明，但没有建立与现场2026年硬件网关的兼容关系。
- 仓库树含多个历史APK，没有找到`.thrift`协议文件或SDK说明。

**不能把这个旧包认定为现场机顶盒应用，也不能让门店直接安装替换现有面板固件。**

## 3. 康康驾到公开Web客户端：找到实际配置接口线索

- 应用：https://bsass.com/
- 页面公开配置：https://bsass.com/info.js?v=202202181640
- 主入口：https://bsass.com/js/app.589f0301.js
- 公共模块：https://bsass.com/js/common.a8205cc3.js
- 业务模块：https://bsass.com/js/product.378fd6d7.js

以上路径由公开页面及其模块加载器发现。只读取公开静态文件，没有发送这些接口请求。

前端硬件配置模块包含以下相对路径（POST调用声明）：

- `sysRollBellKing/getSysRollBellKingSetting`
- `sysRollBellKing/getHardwareResourceByTenantId`
- `sysRollBellKing/selectSysTenantResourceOverride`
- `sysRollBellKing/InitialSwitchDownload`
- `sysRollBellKing/InitialDeviceDownload`

界面有4.3/7两种设备分类、设备授权数量、房间绑定、菜单下发选项；原生桥接包含`getHardwareApplicationMode`与`toggleHardwareApplicationMode`。钟房APP标识为`BELLROOM`，与点钟王分类不同。

这些是**厂商应用调用自身后台的配置接口**，并非已公开授权的第三方API，也不等于TCP8032的设备协议。公开文件没有提供完整鉴权合同、设备登录注册码规则、Thrift字段规范或第三方联调沙箱。不能拿已有厂商会话替代澜序独立设备授权。

## 4. 已检索但没有匹配协议的方向

- 思软／康康驾到／7plus／点钟王与协议、SDK、开发、通讯、接入文档等组合。
- eissoft／eisaas品牌及域名关键词。
- GitHub仓库检索及eissoft账号公开仓库树；Gitee、ShowDoc的搜索引擎索引。
- 现场独特符号`TRpcService`、`OnAnsweCall`、`SystemDeviceLogin`、`ReportClock`、`Hard43`。
- 官网帮助中心、下载中心、商学院、点钟王产品页及康康SAAS介绍。

排除结果：其他品牌硬件协议、HTTP/MQTT通用教程、宣传软文及无关同名结果，不作为本设备协议证据。

## 5. 追加追踪：现场程序使用的公开更新渠道

从用户提供ZIP中的`启动点钟王服务.exe`静态读取到两个更新地址，均在未登录、未提交厂商Session的情况下通过正常HTTPS读取成功：

- https://appupdate.eisaas.com/hardware/update.xml
- https://appupdate.eisaas.com/hardware/update_c.xml

后者是gzip压缩XML，解压后XML结构与前者相同。更新清单标记应用“点钟王服务程序”，版本`1.1.9266.10407`。本次保存的update.xml SHA256为`0542978dbabce51201278d83306299862948fd7aa0fea6538426b935de7ec20a`。

按清单FileHash与用户ZIP逐文件计算MD5比较：18项中17项一致，包括核心`hardware_amd64.exe`及启动程序；只有启动程序manifest项不匹配。MD5此处仅用于与厂商清单比较版本内容，不视为可信签名验证。

因此，该公开渠道当时发布的核心网关不是一个比用户包更新、尚未分析的程序。清单包含EXE、DLL、XML及manifest，没有列出APK、Thrift IDL、设备协议文档或钟房固件。未运行更新程序，未安装或替换任何门店文件。

再次检查康康公开Web静态模块：找到的下载项仍是水吧PC程序，BELLROOM仅作为钟房APP权限分类出现，没有得到钟房安装包地址。未将水吧程序或旧HTTP点钟APK冒充钟房应用。

## 下一步真正需要的资料

### 再次追加：官网桌面客户端发布包

从官网https://www.eissoft.com/kkjd/页面的实际下载链接取得https://appupdate.eisaas.com/desktop/kkjd-exe.rar，112298103字节，SHA256为`09304ef7bff0b887ce90d3a6231fd40deb534bce759975a74bc11430b88463a4`。仅保存在.runtime中并静态读取目录和app.asar，未运行厂商代码。

目录为Windows Electron桌面客户端，安装包标记KKJD Setup 1.2.1。未发现APK、Thrift IDL或协议文档。app.asar中的非node_modules业务文件包含主窗口、打印、更新相关代码；入口指向https://www.eisaas.com，更新地址为https://appupdate.eisaas.com/desktop/electronSAAS/。该地址下正常读取的latest.yml当时仍标记1.1.0、发布时间2021-11-24，不能将其当作当前设备固件渠道或要求门店降级。

读取入口页面实际引用的公开JS https://www.eisaas.com/js/app.b6a857c3.js（1373742字节）后，下载项仍指向水吧PC、打印及浏览器程序，未取得钟房APK。修正线索解释：此代码中的https://eissoft.com/first.html标记为“代理商1”，不是已确认的APP发布页；5.yunfoot.com对应微信信息业务接口备用地址，也不是硬件下载入口。没有访问这些业务接口。

本次没有新的、可证明设备业务兼容的协议输入，因此没有扩大测试网关支持范围、修改认证规则或部署到生产。公开材料查找不能替代厂商第三方授权及实机验收；尚未找到当前钟房应用并不证明该应用不存在。

### 追加核验：公开旧APK的实际通信方式

对上述SHA256对应的APK，使用官方JADX v1.5.6在本地只读反编译，没有安装或运行APK，没有连接其业务服务。JADX报告2项错误，因此不能声称完整反编译成功；下列相关请求、参数及业务调用方法可读。输出仅放在`.runtime/eissoftclock-static`，不进入澜序构建。

已验证该旧版点钟业务调用采用HTTP POST：`HttpRequest.java`通过`addParams("data", ...)`发送JSON字符串，即表单字段data，不是直接JSON请求体。`RequestParam.java`及`HttpParams.java`表明其JSON包含`client/devid/infid/funid/msgid/optid/roomid/content`；点钟界面调用传入client为字符串4。

| 观察项 | 静态证据 | 适用边界 |
| --- | --- | --- |
| 连接 | SysSettingActivity调用command类别的c_connect | 旧版HTTP客户端 |
| 加钟 | ItemSelect2Activity调用work类别的w_addclock | 未实机验证 |
| 下钟 | CheckEndClockDialog调用work类别的w_endclock | 未实机验证 |
| 请求内容模型 | ClockOperateParam含fj_code/fw_card/js_code/sp_code/xm_code/xs_code字符串及gw_type/jz_num整数 | 不凭字段名推定全部业务含义 |
| 成功判断 | JSONUtils比较响应code的文本值是否为1 | 不能套用到当前Thrift响应 |
| 连接响应 | ConnectResponse为code加content，content映射BaseInfo；包含company/appver/softver/spver/datetime等 | 无真实响应样本 |
| 应用版本 | clockking/b.java声明versionCode 20007、versionName 2.0.07 | 不等于现场固件V23101001 |

这已超出字符串推测，确认公开旧包的一条实际HTTP业务路径；但不能据此断言APK所有通信都只有HTTP。现场Hardware日志和程序则显示TCP8032及Thrift调用，尚无证据证明当前面板接受这套旧HTTP格式。**不得以旧版HTTP适配器替代当前面板协议，亦不得要求门店降级固件。**

本次额外检索eissoft+thrift、eisaas+hardware+SDK、点钟王+8032、现场固件版本及手册全名，未得到匹配的公开协议正文。重复相同检索不会补齐授权及消息语义。当前仍缺当前固件协议、实际登录/菜单响应及钟房APP资料；下列资料取得前，完整互通验收处于外部资料阻塞状态。

1. 当前7寸面板固件对应的TCP8032 Thrift IDL、传输/分帧设置与调用约定。
2. `SystemDeviceLogin`响应字段已从现有日志提取（见现场证据文档）；仍缺`regsn`含义、第三方服务的设备授权方式及真实设备验证。
3. 菜单格式与`pgid/funid`语义、报钟/下钟的成功失败及重复请求约定。
4. 钟房盒子当前APP包名、版本、安装包、推送/播报消息合同。

官网技术咨询号码：400-8787-680（来源：https://www.eissoft.com/about/）。本次没有代用户联系、提交申请或承诺付款。

### 追加：公开前端配置字段及适用设备分支

本轮重新检索品牌、接口文档及 `SystemDeviceLogin/SystemClockInfo`，未取得当前固件协议正文。官网帮助及下载页的本次抓取超时，不能据此判断页面不存在。以下增量来自已下载的公开 `common.a8205cc3.js` 与 `product.378fd6d7.js` 静态代码，没有调用厂商业务 API。

- 模块 `2f70` 是 `sysRollBellKing` 接口封装。`6e44` 组件只筛选 `type=1`；上级组件将 1 标记为 4.3，2 标记为 7。`InitialDeviceDownload` 与 `InitialSwitchDownload` 的下发调用出现在这个 4.3 分支中，不能直接据此实现现场 7 寸面板菜单协议。
- 下发请求复制选中的设备或交换机对象，再将所选 `needDownload*` 字段设为布尔 true。`all` 包含呼叫服务、项目、商品、商品类别、项目类别、欢迎画面和菜单；不包含 `needDownloadVoiceAlert`。呼叫字段原拼写为 `needDownloadCallServcie`。完整设备对象仍来自后台响应，公开代码不包含实例。
- 7 寸配置以 `paramKey=sevenKingSetting`、`paramValue=JSON.stringify(sevenForm)` 保存。界面直接确认以下配置含义：`ChangeServiceBeforeClockOn=1` 为报钟可换项目；`ClockWithTechnicianCard=1` 为报钟、加钟、下钟二次刷工卡；`OpenRoomWithGuestCard=1` 为开房需刷手牌；`CleanOtherRooms=1` 为可清扫其他房间。
- **反向布尔语义**：界面“加钟可换项目”的 true-value 为 0，false-value 为 1，对应字段 `AddClockWithoutService`。未勾选时说明为沿用上一个钟的项目、数量为 1。不能按字段名或一般布尔规则猜测。
- 前端提示“更改设置后确定保存，重启设备才生效”。这仅确认该版本配置界面的提示，不证明现场固件一定接受这些设置。

这些发现补充了配置层含义，尚未补齐 TCP 菜单数据结构、`pgid/funid` 映射、注册合同或写操作回执。未将这些配置直接加入模拟成功路径，也未部署生产。

### 追加：网站链接爬取与全部公开提交树核验

按用户要求改用链接爬取，而不是只依赖搜索引擎。`.runtime/crawl-vendor-public.py` 从官网、帮助、下载、7 寸产品、服务和康康页出发，仅跟随实际出现的公开服务/帮助/下载链接；最多 30 页、并发 3、单页上限 2 MiB。实际取得 23 个 HTML 页面，0 个抓取错误，原始 HTML 及 SHA256 和链接索引保存在 `.runtime/vendor-site-crawl/index.json`。未提交表单、未调用营业接口、未发送厂商凭证。

这些页面中可识别的安装包、文档、协议文件及外部下载候选仍只有 `https://appupdate.eisaas.com/desktop/kkjd-exe.rar` 和 `https://pan.baidu.com/s/1jG4305C`。前者已有静态分析；后者本次 web 抓取不可用，未取得文档正文。不能声称已爬完官网所有内容，也不能根据文件未出现在这些页面就断言其不存在。

另外通过 GitHub 公开 API 核验 `eissoft/eissoft.github.io`：1 个 master 分支、0 个标签、0 个 Release；全部 6 个公开提交均为 2020-05-29。进一步读取每个提交的递归文件树，6 次均未截断。候选文件仅为手机、平板及历史点钟 APK（包含 1.0.4—1.0.18、2.0.3、2.0.7），未发现历史提交中额外的 PDF/DOC、Thrift IDL、Proto 或按名称标记的 SDK/协议文件。未逐一反编译所有旧 APK；最新旧点钟 APK 已分析为 HTTP 路径，参见前文。

证据索引：`.runtime/vendor-github-history-index.json`、`.runtime/vendor-github-historical-files.json`。本轮没有取得可补齐当前 V23101001 注册、菜单和业务写入语义的新资料；模拟器及生产适配范围保持不变。

## 2026-09-15 公开网络复核

按用户要求重新检索思软/康康驾到点钟王及钟房端厂商协议。检索包括 SDK、协议文档、TCP、8032、SystemClockInfo、SystemClockRemind、OnAskCall、SaasTenantResource；返回的无关品牌 API 不作为证据。

实际打开核验：
- https://eissoft.com/products/4/ ：7寸plus产品功能页，包括房态/技态、上下钟通知、呼叫与调派；本次读取未见报文字段、鉴权或回执合同。
- https://www.eissoft.com/kkjd/ ：明确有独立钟房端，展示排钟、预约、等待。不能据此断言采用与房间面板相同的协议。
- https://eissoft.com/help/ ：当前索引是数据库、安装、云BOSS与连锁常见问题，未取得硬件 SDK。
- https://eissoft.com/xiazai/ ：列出APP、用户手册、接口及驱动下载，页面各下载项指向同一百度网盘链接；工具跟进该链接失败，未读取包内容，不证明资源不存在或分享已失效。
- https://github.com/eissoft/eissoft.github.io ：重新确认公开仓库含 eissoftclock_2.0.7.apk、eissoftPad.apk、EissoftPhone.apk、EissoftPhoneJS.apk。
- https://raw.githubusercontent.com/eissoft/eissoft.github.io/master/index.html ：确认上述包及archive历史包发布链接，是此前已分析线索，不是本轮新增当前固件SDK。没有重新下载相同APK冒充新发现。

结论：本轮未新增足以实现设备注册授权、实际菜单映射或Android钟房播报的协议证据。不能把“公开产品宣称可对接”或其他品牌通用API当作本设备兼容性证明。本轮仅研究，不改生产配置或调用厂商租户接口。

## 2026-09-15 官方仓库 Android 包追加分析

从厂商公开 GitHub 仓库下载并仅静态分析另外三个官方 Android 包：

| 文件 | 字节数 | SHA256 |
|---|---:|---|
| `eissoftPad.apk` | 14,526,543 | `5712A04F80FE8A4EF6E5D564AF544F27DD69DE4DC251508C76184213A15CEF9B` |
| `EissoftPhone.apk` | 19,146,477 | `544F79ACDC4458B1741BEB9041ECFF714376A32BA24EDA7E5139D9ACCA9A4106` |
| `EissoftPhoneJS.apk` | 20,943,351 | `7DC6BF84ED124856046660A355CEC2CC006820D7BC95FB2550384B4785E8AC7C` |

JADX 1.5.6 对 Pad、Phone、PhoneJS 分别报告 2、3、3 个反编译错误，因此下面只记录可由源码或字符串直接核验的部分，不把未反编译代码补猜成协议。

`eissoftPad.apk` 使用与历史 `eissoftclock_2.0.7.apk` 相同的旧 HTTP 协议族：向配置 URL 发送 POST 表单字段 `data=<JSON>`。默认可见地址为 `http://server.app.eissoft.com/`，设置页也可组成 `http://{IP}:{port}/`。公共请求字段为 `devid`、`client`、`infid`、`funid`、`msgid`、`optid`、`roomid`、`content`，Pad 请求的 `client` 为 `3`，历史 Clock 为 `4`，`optid` 使用 `system`。

Pad 常量进一步公开了旧协议的业务名：

- 查询/操作：`c_connect`、`c_login`、`c_getroom`、`c_getclock`、`c_getqueue`、`c_arrange`、`c_getwait`、`c_addwaitinfo`、`c_cancelwait`、`c_getbook`、`c_addbookinfo`、`c_cancelbook`、`c_bookin`、`c_waitin`、`c_callfw`、`c_getworkinfo`、`c_savebill`。
- 钟务/房态：`w_openroom`、`w_backroom`、`w_clearroom`、`w_changeroom`、`w_startclock`、`w_addclock`、`w_endclock`、`w_backclock`、`w_changeclock`、`w_changeitem`、`w_changeserver`、`w_attendance`、`w_login`。
- 消息：`m_bell`、`m_endclock`、`m_message`、`m_update`。
- 基础资料：`b_roominfo`、`b_iteminfo`、`b_empinfo` 等。

钟务参数模型 `ClockOperateParam` 可直接核验的字段为：`fj_code`、`fw_card`、`gw_type`、`js_code`、`jz_num`、`sp_code`、`xm_code`、`xs_code`；其中 `gw_type`、`jz_num` 为整数。历史 Clock 包比 Pad 多出 `C_GETMODE`、`c_getwork`、`m_hasbook`、`m_haswait`、`w_arrangeclock` 五个常量，说明即使同属旧 HTTP 家族，不同终端的命令集合也并非完全一致。

两个 Phone 包的业务逻辑主要位于 Delphi 原生库 `libEissoftPhone.so` 和 `libEissoftPhoneJS.so`。静态字符串可确认 `server.app.eissoft.com`、`Afunid`、`Ainfid`，以及登录、房态、开房、退钟、换房、清房、呼叫服务等窗体或类名；未发现当前 TCP 8032 网关的 `SystemClockInfo`、`SystemClockRemind`、`OnAskCall`、`OnAnsweCall`，也未发现钟房播报 SDK 或消息合同。

这批证据扩展了旧 HTTP 协议的命令枚举和钟务字段，但现场 V23101001 固件已经观察到 TCP 8032/Thrift 风格网关。没有证据证明上述旧命令可被当前设备接受，缺少设备注册授权、菜单 `pgid/funid` 映射、写入幂等与回执语义，不能直接接入生产或标记为实机兼容。

### 旧点钟王封包、回执与到钟提醒

继续沿调用点核验后，旧点钟王的封包规则可以细化为：

- `infid` 的已知值为 `command`、`work`、`message`、`downbase`、`downimage`。
- 房间终端业务请求通过 `paramsContentByClock` 生成：`devid` 取设备标识，`client="4"`，`roomid` 为房间号，`optid` 在钟务操作中为技师号，在消息轮询中为 `点钟王`，`msgid` 固定传空字符串，`content` 为具体对象。
- 报钟 `w_startclock` 的 `content` 模型为 `js_code`、`xm_code`、`sp_code`、`fw_card`。
- 加钟 `w_addclock` 使用 `ClockOperateParam`，至少由界面实际设置 `js_code`、`xm_code`、`jz_num`；部分流程还传 `fw_card`、`xs_code` 等字段。
- 下钟 `w_endclock` 至少传 `js_code`、`fw_card`。成功由顶层字符串字段 `code` 等于 `"1"` 判定；顶层 `content` 可为空、文本或对象/数组。失败提示直接读取 `content`，没有观察到独立错误码表。

旧点钟王并非靠服务端主动推送到钟提醒。`BackgroundTaskService` 启动 70 秒后，每 30 秒轮询一次 `infid="message"`、`funid="m_endclock"`；请求 `content` 为 `{code: 房间号, type: "0"}`，`roomid` 为房间号，`optid="点钟王"`。成功返回的 `content` 被解析为数组，每条可见字段为 `id`、`fj_code`、`js_code`、`fw_type`、`fw_xmcode`、`fw_name`、`fw_dpsj`、`fw_xasj1`。应用以 `id` 本地去重，用 `fw_xasj1` 计算剩余分钟，并在终端本地合成“{技师号}号{分钟}分钟后到钟”或“{技师号}号已到钟”，每条最多播两次。

这说明 `m_endclock` 在该历史版本中是轮询式提醒合同，`m_bell` 虽存在常量但没有找到实际调用点。它可用于完善旧协议模拟器与兼容适配器测试，不能证明当前 TCP 8032 固件沿用同一结构。

### 官网公开百度网盘目录已成功读取

官网“下载中心”指向的 `https://pan.baidu.com/s/1jG4305C` 实际可公开访问，分享方显示为“长沙**软件”，根目录为“思软足浴桑拿软件”，页面标记永久有效。通过网盘公开列表接口读取目录，没有登录、绕过访问控制或调用厂商业务系统。

根目录公开内容包括用户手册、数据库、视频学习、驱动程序、门锁柜锁接口、离线升级包、酒店餐饮接口、APP 安装包，以及思软足浴/洗浴管理系统 V5.7 安装程序。与点钟王直接相关的新文件是 `7寸平板点钟王施工标准规范（2019版）.doc`，大小 944,640 字节，网盘 MD5 为 `019f42e065a24e2e2c83cfb2dd8b531c`。文档预览转换后的 5 页 PDF 已保存为 `.runtime/7inch-clockking-standard-2019.pdf`，SHA256 为 `08C21E9825C1A5FA6F6876E793AD23A5768E0458D59B73D13E8D4933D7B7DA0D`。

该施工规范确认：

- 7 寸平板支持以太网或 Wi-Fi，供电支持 POE 或 12V/2A；有线施工要求五类及以上网线、统一 568B 接法。
- 设备端进入点钟王应用的设置项后填写服务器 IP；现场照片中出现的端口 8032 不在这份 2019 文档正文中。
- 文档列出的设置/服务密码为 `4008******`；这是公开施工文档中的历史设备设置密码，不应当作当前设备或厂商账号凭证（原文为公开施工文档中的历史设置码，非当前凭证，已脱敏）。
- 服务器端使用 `AppServer` 管理器配置相关参数；平板 APP 更新地址也在 `AppServer` 中设置后由设备更新。

公开目录的“APP安装包”当前仅列出 APP 白名单说明和视频，没有点钟王 APK；“门锁柜锁接口”和“酒店餐饮接口”目录当前为空。“离线升级包”含 `server_V5.20.rar`（270,736,683 字节）与 `server_V4.56.rar`（88,013,056 字节）。本轮未下载或执行这些服务端升级包，也未把历史设置密码用于任何设备。

这份资料解决了网络施工、设备端入口和 AppServer 配置位置的证据缺口，但仍不是 TCP 8032 的 IDL、方法参数、注册授权或菜单业务合同。

## 2026-09-15 当前协议公开检索复核

继续以当前门店日志和固件可见标识检索厂商官网、GitHub、Gitee及通用搜索索引，关键词覆盖 `8032`、`SystemDeviceLogin`、`SystemClockInfo`、`SystemClockRemind`、`OnAskCall`、`OnAnsweCall`、`ReportClock`、`GetCallServerInfo`。公开索引仍未出现厂商发布的 TCP 8032 IDL 或业务协议正文。官网能确认点钟王、钟房端及可拓展接口属于正式产品能力，但没有公开第三方接入合同。

已由门店日志与厂商二进制交叉确认的当前传输层不是猜测：设备通过 TCP 8032 使用 Apache Thrift Binary Protocol 风格的 RPC 包；外层方法为 `OnAskCall`，回包方法为 `OnAnsweCall`。请求结构包含 askId、业务 URL、字符串头表和字节正文；当前已完整解码 `SystemClockInfo`、`SystemDeviceLogin`、`SystemUserLogin`、`HeadBeat`、`CheckHandCode`、`CheckJSCode`、`ReportClock`、`CloseClock`、`GetTecQueryList` 等现场样本，具体字段形状保存在 `tools/hardware-gateway/request-shapes.evidence.json`。

当前仍缺的是业务授权层：`SystemDeviceLogin` 会读取租户和 `SaasTenantResource`，并参与设备注册码计算；菜单与可操作功能由厂商租户资源下发。公开网页和旧版手册不能证明第三方可以生成有效注册码，也不能证明旧 HTTP 点钟王的 `funid/infid` 能用于当前固件。因此生产网关继续只放行已验证的只读 `SystemClockInfo`，写入钟务动作不以模拟结果冒充兼容。

为防止后续把旧协议、推断字段和现场证据混用，当前证实部分另存为机器可读合同 `tools/hardware-gateway/current-protocol.evidence.json`。该文件明确标出每个方法是已验证读取、依赖厂商授权、依赖菜单，还是禁止写入，并列出尚未解决的字段。

### 旧中间件不能替代当前 8032 协议

公开资料对 `BurroService.exe` 的来源提供了进一步交叉证据：QuickBurro 是 Delphi 三层中间件，使用节点、插件和远过程调用模型；公开的 2.50 版本说明还明确加入了自定义网络通信密钥，即使已知协议格式，没有密钥也不能建立兼容通信。因此 `server_V4.56/V5.20` 即使取得，也只能用于研究旧 PC 中间件部署和插件名称，不能据此推定当前康康驾到点钟王的设备注册码、菜单授权或 TCP 8032 业务方法。

### Server V4.56/V5.20 服务端线索

进一步预览公开文件 `中间件升级操作说明ServerV4.56.doc`。转换后的 13 页 PDF 保存为 `.runtime/server456-upgrade-manual.pdf`，SHA256 为 `D0FD7AB0FF3689F01DCE6FEDA3747751E1566634C3A90928EB3D0087B5A10A79`。文档可直接核验以下服务端结构：

- 升级前停止旧版中间件，备份 `server\config` 和 `server\plugins`。
- 新版覆盖后恢复 `server\config` 以及 `server\plugins\common\*.sys`。
- 服务进程包含 `burroguard.exe` 与 `burroservice.exe`，新中间件需要以管理员身份启动。

公开资料显示这两个进程属于 QuickBurro/Delphi 中间件体系，提供节点、插件及 RPC 能力；这只能说明思软旧服务端使用了该中间件，不能据此推出点钟王业务插件的方法名或线上的 TCP 8032 协议。尤其是现场 `Hardware` 网关已观察到 Go 日志和 Thrift 风格方法，不能把两套组件当成同一协议。

## 2026-09-15 公开仓库与网关配置一致性复核

通过 GitHub 官方仓库树 API 读取 `eissoft/eissoft.github.io` 的完整 `master` 文件树（API 返回 `truncated=false`）。按 APK、hardware、clock、Thrift、protocol、SDK、API、更新和文档关键词过滤后，仅有旧 `eissoftclock_1.0.4` 至 `2.0.7`、Pad、Phone/PhoneJS APK；没有当前 TCP 8032 的 IDL、SDK 或接口文档。旧 APK 协议不能自动用于用户照片中的 V23101001 面板。

独立测试网关配置原本只拒绝重复面板 IP 和设备编号，未拒绝两台面板绑定同一个 SaaS 房间 ID。云端已经拒绝这种绑定，网关本地也现按 `roomId` 拒绝，并用两台不同 IP/编号、同一房间的构造样本验证。网关/模拟器 7 项测试通过。该修正只保证本地配置与云端绑定约束一致，不增加未知厂商写操作能力。

协议输入还增加严格 UTF-8 解码。此前 Node 的 `Buffer.toString('utf8')` 会以替换字符继续解析损坏的正文或 Thrift 方法/头字段；现在 JSON 正文、RPC 方法名、URL、头字段以及应答文本遇到非法字节时明确失败。用损坏方法名与损坏 JSON 字符串的构造报文验证，协议/网关/模拟器 9 项测试通过。此项是输入边界修正，不证明当前固件支持写操作。

## 2026-09-15 登录授权实时核对

桌面 `createGatewayController` 已在启动时将本机原厂授权和菜单缓存传入 `createHandler`，并非只检测而未连接登录链路。本轮新增本机 TCP 合成面板往返测试：在提供合成原厂缓存和有效澜序网关会话时，`SystemDeviceLogin` 返回已重建的登录结构；同一连接的 `ReportClock` 仍返回明确失败，不落业务写入。

发现并修复登录授权时序问题：此前登录只依赖网关启动时的云端授权快照，授权被撤销后、周期心跳发现之前仍可能发出登录菜单。现在每次成功登录前重新查询 `/api/hardware/v1/session`，精确核对当前网关 realm、门店、业务类型及设备编号/IP/房间绑定；会话失效或绑定变动直接返回 Thrift 失败，不发菜单。合成 TCP 测试覆盖首次登录、写请求拒绝、随后撤销时登录拒绝；网关、协议、登录与控制器共 13 项测试通过。现场面板登录是否接受该响应仍未实机验证。

仓库树来源：https://api.github.com/repos/eissoft/eissoft.github.io/git/trees/master?recursive=1

已通过公开分享页的 `/share/tplconfig` 和 `/api/sharedownload` 取得 `server_V5.20.rar` 的下载请求，但百度随后返回 `errno=-20` 并要求验证码。没有尝试识别或绕过验证码，因此尚未取得该 270,736,683 字节升级包，不能声称已经分析 V5.20 二进制。

## 2026-09-15 官方资料再核查

再次检索思软 7plus 点钟王、康康驾到、`RollBellKing`、`SystemDeviceLogin`、`OnAskCall` 等关键词。官网 [7寸plus点钟王产品页](https://eissoft.com/products/4/) 明确列出报钟、下钟、加钟、房态查询和服务呼叫等操作，但没有字段、报文或授权合同。[下载中心](https://eissoft.com/xiazai/) 列出 APP、用户手册、门锁柜锁及酒店餐饮接口等历史下载类别，也没有把当前点钟王 TCP 8032 接口公开为第三方协议。不能把官网上的“可拓展接口”或其他设备的通用 TCP/MQTT/HTTP/Modbus 资料当成当前设备合同。

通过 GitHub 官方用户仓库 API `https://api.github.com/users/eissoft/repos?per_page=100` 核对公开仓库清单，目前只返回 `eissoft.github.io` 一项（最近更新于 2020-05-29）。因此不存在另一个已公开的同名账号协议仓库可直接取用；这仍不能证明厂商在其他账号、私有仓库或未索引站点没有文档。

隔离测试环境文件 `.runtime/test.env` 的三个数据库 URL 均指向本机 `127.0.0.1:15433/za_spa_saas_test`，当前端口探测不通。只读取了变量名和连接目标，没有输出凭证。此前完整 SaaS 回归的失败项仍须在隔离数据库可连接后重新定位，不能以网关合成测试替代完整回归。
