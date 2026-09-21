# 现场硬件资料检查（2026-09-14）

本次仅静态读取用户提供的压缩包与照片；未运行厂商程序、未使用其中的登录凭证、未修改门店设备或澜序生产系统。

## 已确认的证据

- 两个ZIP的155个条目名称、大小与CRC一致；不是两套不同协议资料。未压缩合计6,602,975,802字节，主要为运行日志。
- 包含 hardware_amd64.exe、启动点钟王服务.exe、依赖库和日志；未发现 .thrift、.proto、源码或协议说明文档。
- Bizlog.2026-09-13.txt 明确记录监听0.0.0.0:9898，以及开启Thrift服务0.0.0.0:8032。
- 照片21：房间面板服务器192.168.10.254、端口8032、房间号203。照片20：面板IP192.168.10.33，掩码255.255.255.0，网关192.168.10.1。与用户提供前台电脑IP192.168.10.254/24在同一子网。
- 9月13日通信日志匹配192.168.10.33 → 203房间，共观察到19组IP/房间映射；这是历史记录，不等同于当前19台均在线。
- 完整扫描9月13日Commlog：SystemClockInfo 107816、HeadBeat 108031、SystemUserLogin 78、CheckHandCode 49、ReportClock 44、conn 44、CloseClock 26、CheckJSCode 10、GetTecQueryList 10、SystemDeviceLogin 7次（按request.GetURL日志计数）。
- 请求封装可见url/head/body，头字段包括MSG_ID、interface、roomid、devid、from_session、cardid、optid。响应可见msg/data/code。日志展示的JSON不是TCP线上帧格式的充分证明。
- 二进制静态符号存在Hard43/thriftDevice及TRpcServiceHandler。后续已重建请求/响应字段及OnAskCall/OnAnsweCall方法，并用独立Apache Thrift样本验证编解码；真实设备的帧格式仍未验证。
- 用户9月14日启动日志显示厂家云信息同步和MQTT通知连接成功；这不能证明房间面板或技师房机顶盒当前工作正常。
- 照片中的另一设备标签为钟房机顶盒，底标X88 MINI 14 TV、Android14.0、2G/16G；可见网线和HDMI接线。标签规格未进行系统实测。机顶盒应用包、配置页面、实际通信协议尚未提供。

## 故障线索及边界

log.txt.20260911记录服务器向面板写入TCP应答时连接被本机软件中止；涉及8032连接。DNS日志也有间歇超时。仅据这些记录不能认定是IP冲突、防火墙或设备损坏。多数成功房态应答证明至少历史上通信成立。

0.0.0.0是程序绑定监听地址，不应填写为面板的服务器地址。8032是已确认的面板Thrift端口；9898用于本地HTTP服务（用户日志可见/log/readFile），不能把它当成面板协议端口或无条件开放的第三方控制API。MQTT是另一个厂家通知通道，尚不能据此认定盒子也直接订阅相同主题。

## 澜序对接下一步

这些资料足以把房间面板从未知网络协议缩小到本地TCP/Thrift适配方向，也提供了业务操作样本。仍须确认Thrift方法/字段编号/类型、帧与编码方式、登录与设备绑定、请求响应关系、菜单下发及重连处理。可优先索取厂商IDL/SDK；否则在授权测试环境做更深入静态分析和单台备用设备抓包验证。先验证登录、心跳、只读房态，再接报钟/下钟等写入。

钟房机顶盒应独立调查应用名称/版本、服务器配置、应用包或正式SDK及一次叫号的消息流。当前材料不证明它与房间面板使用相同协议。

不应直接将正在营业的设备服务器改成澜序域名或云端IP；本地现已有Thrift只读网关原型，但设备登录与业务写入未完成，未发布生产。网关使用澜序独立门店授权，不能沿用厂商租户号或Session作为澜序身份。

## 后续静态核对：登录和业务菜单

对用户提供的同一可执行文件继续只读分析：ProcessSystemDeviceLogin直接调用GetThriftMenuContent、getDeviceRegCode和Md5；GetThriftMenuContent读取GetSysTenant及GetSaasTenantResource。可确认登录涉及设备注册码计算及厂商租户菜单资源，不能仅凭端口相同认定可直接兼容。调用关系不证明注册码算法、校验范围、设备开放能力或是否允许第三方接入；这些仍未知。未复制注册码、租户身份或绕过校验。

后续对同一 SHA256 二进制的调用参数和 Go 反射类型完成交叉解析，补齐了注册码算法，但没有补齐授权来源：`getDeviceRegCode`先从 `HKLM\\SOFTWARE\\Eissoft\\HARD\\LOCAL` 读取以设备标识为值名的字符串；不存在时，厂商程序向其旧授权服务提交该设备标识并接收32字符注册码。返回外层 JSON 字段为 `result/content`，`content` 再解析为 `isNewRecord/code/msg/data`；仅 `code == "1"` 且 `data` 长度为32时写入本机。登录返回的 `regsn` 为小写十六进制 `MD5(注册码 + datetime)`，其中 `datetime` 格式精确为 `2006-01-02 15:04:05`。这证明签名计算方式，不授予生成或获取注册码的权利；澜序实现只接受厂商已合法配置的注册码，不调用厂商授权服务，也不绕过注册。

新增 `tools/hardware-gateway/inspect_vendor_log.py` 对9月13日通信日志完整流式扫描，请求记录解析失败0条。生成的 `request-shapes.evidence.json` 仅保存接口白名单、字段类型与计数，不保存业务值、设备身份、Session或密码。脱敏测试通过。

- SystemDeviceLogin：body为null，设备信息来自请求头。
- SystemUserLogin：body包含字符串id，其具体身份语义未确认。
- ReportClock：外层数组元素包含`pgid`、`funid`及`data`对象；已观察的`data.array`为 JSON 字符串数组，每个字符串解码后包含`bh`、`mc`。该嵌套形式来自日志样本，不能改写成未观察到的直接对象数组。
- CloseClock：数组元素包含pgid、funid，data为null。
- CheckHandCode：data包含bh、id；CheckJSCode：data包含bh。

这些只证明日志中的数据形状，不证明pgid/funid与澜序项目、技师、订单的业务映射。继续开放报钟/下钟之前，必须确认菜单定义、设备登录和实机请求对应关系。钟房盒子的Android应用与播报消息流仍不在所提供资料中。

原始材料含登录Session及业务信息，本文不收录这些凭证。建议重新登录厂商软件，并通过其支持方式使已分享的旧会话失效。

## 追加：实际应答结构及报钟失败分支

再次完整流式检查9月13日Commlog，仅提取字段名、类型及计数，未导出注册码、操作员身份、权益值或业务文本。

| 接口 | 应答数量 | data结构 |
| --- | ---: | --- |
| SystemDeviceLogin | 7 | company、datetime、menu、regsn、roomname、support、welcome为字符串；exittime、freshtime、outtime为整数；mainmenu在这些样本中为空对象 |
| SystemUserLogin | 78 | optid、optname为字符串；root为字符串数组 |
| CheckHandCode | 49 | bh、mc字符串组成的对象数组 |
| CheckJSCode | 10 | bh、id字符串组成的对象 |
| GetTecQueryList | 10 | bh、mc字符串组成的对象数组 |
| ReportClock | 40成功分支，4失败分支 | 字符串 |
| CloseClock | 26 | 字符串 |

上述成功分支均有msg/data/code字段。已单独核对设备登录、用户登录、报钟成功及下钟这些样本的code均为整数1；不能据此认定所有接口只有一个成功码。

重要纠正：44条ReportClock请求并非只记录了40条应答。另4条由`AnswerOneWayFailReason:33`记录，JSON中有msg和data两个字符串字段，**没有code字段**。这是日志层面的完整计数对应，不能替代基于请求ID的逐条关联或TCP收包证明。不得把缺code自动当成成功，亦不能推定线上Thrift exstatus的取值。

7条登录样本的menu均为9字符字符串，不是可直接JSON解析的菜单正文，也不是可验证的base64编码JSON；其含义经下述静态追踪进一步确认。mainmenu为空对象，这批日志本身没有补齐pgid/funid菜单映射。钟房盒子消息仍没有样本。

## 追加静态追踪：菜单占位符与Thrift错误状态

仅分析原ZIP中的hardware_amd64.exe，未运行或修改厂商二进制。

### 菜单日志不等于实际发送内容

`AnswerOneWaySuccessForDeviceLogin`的静态指令表明：先序列化登录对象，使用`strings.Join`以逗号连接菜单片段，前后补上方括号，再用`strings.Replace`替换序列化内容中的带引号占位符`"MenuArray"`。这些常量已按PE地址读取核对，不是根据9字符长度猜测。

- `0x92280e`：调用strings.Join，分隔符为逗号。
- `0x92289a`：调用strings.Replace，待替换文本为`"MenuArray"`，替换次数为-1。
- `0x9229f3`起：日志仍使用此前序列化的字节切片。
- `0x922a45`起：发送时使用替换后的字符串并转换为字节切片，随后调用OnAnsweCall。

因此必须纠正之前从日志外形得到的有限判断：**menu在日志中是字符串占位符，但发送前会被替换为菜单数组文本；不可据日志原样构造设备登录响应。**实际完整TCP载荷仍未抓包验证。

菜单来源函数`GetThriftMenuContent`调用GetSysTenant、GetSaasTenantResource，并执行筛选和排序。9月13日Bizlog中未检出该函数名对应的菜单记录。不能因此断言所有日期日志都不含菜单，也不能认定已恢复菜单字段与业务映射。

### 失败状态位于外层Thrift响应

`AnswerOneWayFailReason`在`0x921cf1`向新建响应结构偏移0写入32位整数1，随后填充错误文本、head和data并调用OnAnsweCall。结合此前确认的TRpcResponse布局，该分支设置外层exstatus为1；这解释了失败JSON没有code字段仍可表达失败。

这是本二进制特定失败分支的静态证据，不是实际设备线上收包结果，也不证明所有错误类型都使用相同状态。后续驱动必须分别处理外层exstatus和内层业务JSON，不能只检查JSON code。

## 全日期通信日志扩展检查

2026-08-17至2026-09-13共28份Commlog已按流式方式扫描，识别5,836,017条request记录及16种接口，没有未识别接口名记录。此计数是日志记录数量，不代表独立交易或成功业务数量。此前9月13日单日样本只覆盖10种接口，不能将它作为完整接口清单。

新增6种接口的请求及应答结构已从所有日期提取，解析失败0条：

| 接口 | 请求条数 | 观察到的应答data结构 |
| --- | ---: | --- |
| GetItemInfo | 24 | lb数组元素含ct:int、lbbh/lbmc:string；xx数组元素含lbbh/xxbh/xxbz/xxmc:string |
| GetRoomTec | 6 | 5条含bh/mc字符串对象数组；1条失败分支含msg/data字符串且无code |
| AddClock | 7 | 7条应答含code:int、msg:string、data:string |
| GetWaitRoom | 1 | lb与xx均为空数组，不能据空数组推断非空元素格式 |
| GetItemGradeInfo | 3 | dj数组元素含djbh/djmc:string；lb、xx与GetItemInfo样本字段相同 |
| GetCallServerInfo | 2 | dj、xx为空数组；lb含ct:int、lbbh/lbmc:string |

这6类请求body均为包含pgid/funid/data的数组。除AddClock外，观察到的data均为null。AddClock包含两种data：其一为bh:string对象，其二为包含c:int、lbbh/xxbh/xxbz/xxmc:string的对象数组。这只确认结构，不证明c是数量或时长，也不能凭缩写把bh直接当作技师号、手牌号或订单ID。

完整接口计数：conn 1362、SystemDeviceLogin 475、SystemClockInfo 2912710、HeadBeat 2916607、SystemUserLogin 1794、CheckHandCode 1066、ReportClock 980、CloseClock 695、GetItemInfo 24、CheckJSCode 143、GetTecQueryList 142、GetRoomTec 6、AddClock 7、GetWaitRoom 1、GetItemGradeInfo 3、GetCallServerInfo 2。

分析工具接口及字段白名单已扩展；脱敏单元测试2项通过，覆盖AddClock字段保留类型且不泄露输入值。全日期索引和新增接口结构保存在.runtime中；本文仅记录结构和计数。没有新增设备业务驱动、修改授权或发布到营业设备。仍需把菜单页动作、字段语义及请求对象身份对应起来，才能安全实现写入。

## 新增静态路径：查询来源与声音提醒

继续只读分析同一个hardware_amd64.exe，确认以下函数调用关系：

- ProcessGetItemInfo读取GetBasItemType、GetBasItem、GetItemPrice，并调用PinyinToCode。
- ProcessGetItemGradeInfo另读取GetTechnicianGrade。
- ProcessGetRoomTec除技师信息外还读取员工、角色授权、派工刷新数据、系统配置和房间信息。因此不能简单把查询结果等同于全店所有技师列表。
- ProcessGeneralRequest读取员工和房间信息、配置后调用厂商ApiRequest.GeneralRequest（0x920557）；说明通用业务处理包含厂商API调用。尚未逐分支还原每个动作与参数映射，不能将函数名当作AddClock实现已完成的证据。

### SystemClockRemind的一个具体静态样本

SendSoundAlert在0x9219d5调用TRpcServiceClient.OnAskCall，即服务端主动向设备发送请求，与设备请求的OnAnsweCall应答方向不同。

按PE地址读取的请求url为SystemClockRemind；函数使用MSG_ID、cardid、optid、interface头字段。该函数构造的53字节JSON正文已从立即数拼接并经JSON解析校验：

```json
{"data":{"type":1,"voice":["alert","alert","alert"]}}
```

这证明该特定函数发送的是预设alert声音标识序列，不是已证明支持任意文本的TTS请求。不能把voice数组任意替换成中文句子并宣称可播报。

VoiceAlert还读取派工数据、通知配置并调用SendAlert5、SendExpireAlert、SendAlert；这些其他分支的完整消息合同尚未恢复。现有证据指向Thrift连接上的设备提醒，**没有证明照片中的Android钟房机顶盒接受SystemClockRemind**。没有向门店、厂商云或设备实际发送上述请求。

## 声音提醒分支进一步还原

SendAlert5与SendExpireAlert均两次调用SplitTechnianCode。该函数调用strings.genSplit（空分隔符、n=-1），再以逗号strings.Join；因此是字符拆分，不是数值转换。对于合成编号001，得到0,0,1，保留前导零。没有运行厂商程序。

根据指令中的字符串地址及明确长度读取常量，拼接合成输入并使用JSON解析器验证，得到：

```json
{"data":{"type":0,"voice":["0,0,1,Hao,5,FenZhongHouDaoZhong","0,0,1,Hao,5,FenZhongHouDaoZhong"]}}
```

这是SendAlert5路径，对应静态字符串所表达的五分钟后到钟提醒。SendExpireAlert路径为：

```json
{"data":{"type":0,"voice":["0,0,1,HaoJiShiYiDaoZhong","0,0,1,HaoJiShiYiDaoZhong"]}}
```

两者使用type=0、两个重复的voice字符串，与此前SendSoundAlert的type=1、三个alert字符串不同。合成001仅用于验证格式，不是生产技师号，不是抓包或实际播放成功证据。

SendAlert5常量来源：0x92e27e/0x92e269/0x92e248所引用数据，长度分别28/29/30；SendExpireAlert常量来源：0x92d5de/0x92d5c9/0x92d5a8所引用数据，长度分别28/22/23。SplitTechnianCode位于0x92e3c0，拼接分隔符为逗号。

不能仅凭这些标识推断完整语音资源表、支持所有字母编号、任意中文TTS或机顶盒兼容性。也未确认设备接收后的队列、去重和播放回执规则。上述格式暂只作为协议证据，不接入生产播报任务。

## 追加：菜单资源结构与拼接来源的静态核验

本轮没有执行厂商程序或调用厂商云 API。对用户 ZIP 内 hardware_amd64.exe（SHA256 a293fbc88d152d5cbaf46bcf129c0ef667ad10db644d80237be9b3c0511cb7c0）读取 Go 反射结构元数据，并与现有 GetThriftMenuContent 反汇编交叉核对。

结构地址 0xa524e0，大小 0x110，共 17 个字段，均为 Go string。JSON/GORM 标签直接给出字段名及用途：saasId、parentId、parentTitle、title、url、sortOrder、resourceType、tenantResourceType 等。原始元数据提取结果保存在 .runtime/hardware-menu-resource-layout.json；可复现脚本 .runtime/inspect-menu-resource.py 仅适用于此二进制，不是通用解析器。

已确认：

- 0x927cc0 调用 GetSaasTenantResource 取得资源列表；菜单内容依赖该列表，不能仅靠构造 Thrift 外壳恢复。
- 静态常量直接读取为 TenantId、BATH、FOOT、7。GetThriftMenuContent 对租户资源执行筛选、First、WhereT、OrderByT、ToSlice。
- 资源结构 +0xb0 是 SortOrder，+0xd0 是 Url。排序闭包 0x92e900 从参数副本 +0xb0 读取字符串并调用 strconv.ParseFloat；拼接循环 0x928335 从 rsp+0x2e0 副本的 +0xd0 读取 Url，随后添加逗号和换行。**Url 在这条路径作为菜单片段文本拼接，不应根据字段名就把它当作需要 HTTP 请求的地址。**
- 结合闭包栈帧与字段偏移，推导筛选顺序为：标题包含 FOOT/BATH 的父资源，父级匹配且标题包含 7 的子资源，再取该子资源的后代候选并按 SortOrder 排序。比较调用是 strings.Index，并非严格 ID 相等。此顺序属于静态推导，尚无执行跟踪或实际资源数据复核，不作为生产规则直接复制。

这进一步解释了为什么日志中的 MenuArray 不能还原真实按钮：具体菜单片段来自缓存资源的 url 数据，而不是当前日志中的完整菜单。资源表结构已取得，实际 url 内容、pgid/funid 与按钮的映射、设备接受行为仍未知。本轮未开放设备登录或业务写操作。

继续逐指令复核 `GetThriftMenuContent` 后，可确认菜单字符串的最终生成方式：程序对筛选并按 `SortOrder` 转为数字排序后的资源逐项读取 `Url` 字段，在每段后追加 `",\n"`，最后移除尾部分隔符。筛选链明确使用当前租户、门店业态 `BATH/FOOT` 和设备类别 `7`；中间父子筛选通过资源对象字段及 `strings.Index` 完成。由于现场缓存缺失，仍不能从常量推回具体 `Url` 内容；但可以排除“menu 是固定命令表”的假设——`pgid/funid` 等按钮定义实际嵌在租户资源的 `Url` 片段里，由厂商后台按租户下发。

对包含全部已观察菜单操作的8个日期继续进行脱敏关联分析，共解析1107个 `pgid/funid` 记录、8个不同 `pgid` 和9个不同 `funid`，原始商家标识未写入结果。关系稳定显示：`CheckHandCode` 与 `ReportClock` 使用同一对标识；`CheckJSCode` 与 `GetTecQueryList` 的第一条记录使用同一对；`GetItemInfo` 与 `AddClock` 的项目记录使用同一对。`GetTecQueryList` 和 `AddClock` 都是两条菜单记录组合；`CloseClock`、`GetRoomTec`、`GetWaitRoom`、`GetItemGradeInfo`、`GetCallServerInfo` 分别使用独立组合。这说明请求中的两标识是菜单资源/动作路由，不是每次请求生成的随机编号。

后续对压缩包内全部 28 份 `Commlog` 以只输出聚合计数的 `inspect_message_ids.py` 复核 `MSG_ID`：`ReportClock` 980 条、928 个不同 ID，其中 52 次跨日志复用同一 ID 时正文不同；`CheckHandCode` 1066 条、1003 个不同 ID，其中 63 次复用且正文不同；`CloseClock` 695 条、660 个不同 ID，其中 35 次复用且正文相同。按日期、接口、设备和房间联合分组，这些样本中未出现同组重复。故不能将设备 `MSG_ID` 当作全局业务交易或唯一幂等键；未来开放写入时必须用澜序独立、持久化的交易键和事务去重。该统计不证明厂商服务端的实际去重规则，也不授权开启写入。工具不输出原始面板、房间、卡号或请求正文。

2026-09-15 再核对登录字段类型：日志中的 9 字符 `"MenuArray"` 是序列化前的占位符；厂商静态指令证明发送前会以菜单片段数组替换它。因此网关把 `menu` 序列化为 JSON 数组的类型方向有证据，不能把日志占位字符串直接发送给面板。实际片段内容仍需现场缓存验证。菜单筛选现在拒绝多个匹配的业态根节点或 7 寸节点，以及空的父/面板 ID；此前取第一个可能错选门店菜单。此变更通过 10 项菜单、登录和 TCP 网关构造测试，但没有现场缓存样本证明任一具体菜单项可用。

Windows 客户端的一键检测已增加原厂本机资料识别：只返回思软缓存是否存在、菜单资源数量和32字符授权记录数量。注册码、菜单正文、设备标识和原厂账号均留在 Electron 主进程，不呈现给网页渲染层，也不上传云端；检测过程不修改注册表。

网关侧新增 `vendor-runtime.mjs`：仅允许32位十六进制设备标识，以固定 PowerShell 脚本读取对应本机授权值和菜单缓存；不接受渲染层提供注册表路径或命令。返回内容执行8 MiB上限、期望设备白名单、授权值长度及资源结构校验，任一设备缺少授权即整体拒绝。该读取器尚未接入生产登录响应，避免在没有真实缓存和面板验证时把“能读取”误报为“能登录”。

反射结构布局核对来源：https://raw.githubusercontent.com/golang/go/go1.20/src/reflect/type.go 。官方源码支持解析布局，不是厂商设备协议来源。

## 追加：资源同步接口与注册表缓存位置

本轮进一步沿 GetSaasTenantResource、SyncSysResource、readCache/writeCache 和 GeneralRequest 做只读静态追踪，未执行厂商程序，未向厂商后台发送请求。

确认的调用链：

1. SyncSysResource 调用 GetSysResourceTree（GET）和 GetSysResourceOverride（POST），执行资源树遍历 reverseSysResource，最后写入 SetSaasTenantResource。
2. GetSaasTenantResource 优先检查进程内 go-cache；未命中时通过 readCache 读取注册表字符串，再 json.Unmarshal。此缓存不是 Hardware 文件夹中的 JSON 文件。
3. readCache/writeCache 使用根句柄 0x80000002（HKEY_LOCAL_MACHINE），路径常量为 SOFTWARE\Eissoft\HARD\Cache；菜单值名为 SaasTenantResource。读路径使用 registry.OpenKey / GetStringValue，写路径使用 CreateKey / setStringValue。
4. 从代码常量提取到的相对接口：GET /mesh/tenantResource/getListTree；POST /sysRollBellKing/selectSysTenantResourceOverride；另有 POST /mesh/sysRole/SaasGetSysRoleResourceList。通用业务转发方法 GeneralRequest 使用 POST /v2/inlet/doRun。这些是厂商内部接口证据，不代表第三方可匿名调用或已有授权。

证据地址：GetSysResourceTree 0x7ee884；GetSysResourceOverride 0x7ee987；GetSysResourceList 0x7eed2c；GeneralRequest 0x7f1f2f；注册表根/路径 0x731503、0x731508；菜单值名 0x732c9e、0x732ce1。反汇编索引 .runtime/hardware-resource-sync-disassembly.json，路径索引 .runtime/hardware-resource-source-locations.json，可复现反汇编脚本 .runtime/inspect-resource-sync.py。

本机检查：当前用户电脑的 HKLM 64 位与 32 位注册表视图均不存在该键。未读取其他注册表项、未更改注册表、未导出账号或 Session。因此当前仍没有实际菜单资源内容。**已经精确定位到下一份需要的数据是运行厂商硬件服务的门店电脑上该单一值，而不是重新复制整个 Hardware 目录。** 当前电脑缺失该键不代表门店电脑也缺失；缓存也可能过期，需要与现场固件和实际下发数据核对。

## 追加：通用业务转发请求字段

针对 /v2/inlet/doRun、pgid/funid 和 SaasTenantResource 再次公开检索，没有返回匹配协议正文。对已提供二进制 0xa23060 的反射结构元数据读取确认 GeneralRequest 的 JSON 字段：methodType、tenantId、employeeId、roomCode 为 string，data 为 interface。调用证据为 0x7f2013/0x7f2031 引用该结构，0x7f2043 调用 requestPost；路径见前述 /v2/inlet/doRun。结构结果保存 .runtime/hardware-business-request-layout.json。

这些是网关转发到厂商后台的字段，不能直接当作面板 TCP 请求，也未补齐 methodType 各取值、data 的全部业务规则、幂等和授权合同。没有向此接口发送请求。

现场缓存查看位置：在运行点钟王服务的 Windows 电脑按 Win+R，输入 regedit；将 Computer\HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD\Cache 粘贴到注册表编辑器地址栏。在右侧寻找 SaasTenantResource，双击查看字符串。若没有该键，可检查 HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Eissoft\HARD\Cache。仅查看/复制这一值；不要修改，不导出整个 Eissoft 分支。32 位路径只作为视图检查，不是当前 amd64 程序已确认使用的路径。

## 发布后追加：非通信日志菜单检索

复核用户压缩包中除 Commlog 外的全部 84 份 txt 日志，共 112333539 字节，检索 SaasTenantResource、getListTree、selectSysTenantResourceOverride、MenuArray、pgid、funid、/v2/inlet/doRun。命中集中在 RemoteServiceQuality 日志：getListTree 2573 条、覆盖接口 2573 条、doRun 3034 条。全部匹配行为 10 个竖线分隔字段，没有 JSON 对象或数组分隔符；抽样显示调用地址和结构化记录，不是完整菜单响应。

这确认对应接口在该店实际被调用过，但未取得菜单正文；不能从调用次数推断业务成功，也没有证明其他编码的正文绝不存在。结构化统计保存在 .runtime/hardware-other-log-menu-search.json 和 .runtime/hardware-sync-log-record-shapes.json，未输出日志中的账号、Session 或业务正文。
