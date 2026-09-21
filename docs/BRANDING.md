# ZA Thera｜澜序

用户于 2026-09-08 指定新 SaaS 的品牌：

- 名称：**ZA Thera｜澜序**
- 产品介绍：**洗浴娱乐行业智慧运营系统**
- 标语：**让门店，自成秩序。**

源文件包：`D:\Xiazai\ZENTRA-Web-App-Icons.zip`。选择包内 **App / Jade** 玉绿色款，使用原始资产，未重新绘制。主色 `#315E50`，图形色 `#F3FAF6`。包名中的 ZENTRA 是资产来源名称，不作为产品显示名称。

| 用途 | 包内文件 | 项目文件 |
| --- | --- | --- |
| 登录、侧栏、平台、客户端关于、顾客取号、网页 favicon | `zentra-app-jade.svg` | `apps/client/src/renderer/src/assets/thera-jade.svg` |
| 浏览器添加到主屏幕图标 | `zentra-app-jade-256.png` | `apps/client/src/renderer/src/assets/thera-jade-256.png` |
| Windows 可执行文件、快捷方式、安装程序和窗口图标 | `zentra-app-jade-1024.png` | `apps/client/build/icon.png` |

原始资产 SHA-256：

```text
SVG       19e0c80049bf2f2bc19c8ba7792bc11a62ad5d82d1c44eeb370b0697d6826b2b
PNG 256   04cb829ea4806f356c1f01a0f70e0c0493dd666854f109d82719be4abd1ce913
PNG 1024  649d2ae85f0636514a0ddb54a3c64a5593a36d8b17db143f407f3c064a267624
```

显示文案集中在 `apps/client/src/shared/brand.ts`；HTML 静态 metadata 和安装配置也使用相同名称。Windows 产品名称、窗口标题、菜单、快捷方式及卸载名称为 `ZA Thera｜澜序`，可执行文件为 `ZA-Thera.exe`，安装包为 `ZA-Thera-1.0.0-rc.1-Windows-x64.exe`。

改名保留现有新 SaaS 的技术身份，避免品牌变动引起会话丢失或更新渠道分叉：`appId = cn.zephael.zaspa.saas`、`zaspa-saas://app`、`userData` 目录 `ZA-SPA SaaS`、存储键前缀和 `https://saas.zephael.cn/updates/windows/rc` 均不变。这些身份与旧程序独立。旧项目、旧安装包与旧域名服务不作改名或覆盖。

品牌变更的构建与验收记录见 `STATUS.md`。品牌更新不代表完整 SaaS 功能、生产部署或安装共存已通过验收。

Windows 打包固定使用 `apps/client/build/icon.ico`（从已验证 Jade 原图转换得到的 7 个尺寸，SHA-256 `57292bd61335164e41ba2e986bd1eff1fd8111228360f74c878e46aa77b772a1`）；`icon.png` 保留用于窗口图标。使用 `node scripts/verify-client-artifact.mjs` 核对打包内容、资源图标及更新清单。
