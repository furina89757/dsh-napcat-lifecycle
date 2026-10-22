# dsh-napcat-lifecycle

把 [NapCat](https://github.com/NapNeko/NapCatQQ)（QQ / OneBot 11 协议端）的生命周期绑定到 DeepSeek Harness 宿主进程：**宿主启动它启动，宿主退出它退出**。

## 为什么

外部守护脚本只能轮询，宿主崩溃时会多活几秒，而且配置、日志、状态都散在 DSH 之外。

这个插件走宿主自己的 `ctx.subprocess` 服务：

> 服务 disposal 会 terminate 并 join 每一个仍运行的托管进程，所以进程生命周期跟随消费者重载。

也就是说：**DSH 关闭 → subprocess 服务 disposal → NapCat 及其子孙进程被终止并等待退出**。不需要任何轮询。

## 安装

```sh
dsh plugin --profile <name> add dsh-napcat-lifecycle
```

## 配置

```yaml
- id: napcat-lifecycle
  config:
    napcatDir: 'D:\path\to\NapCat.Shell'   # 含 NapCatWinBootMain.exe
    botQQ: '1667006251'                      # 快速登录用
    qqExe: ''                                # 留空 = C:\Program Files\Tencent\QQNT\QQ.exe
    autoStart: true
    waitPort: 8643                           # 等 OneBot 反向 WS 端口就绪再拉起
    restartOnExit: true
    maxRestarts: 3
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `napcatDir` | 必填 | NapCat Shell 目录 |
| `qqExe` | 空 | QQ.exe 路径，留空用默认安装路径 |
| `botQQ` | 必填 | 机器人 QQ 号 |
| `autoStart` | `true` | 插件加载时自动拉起 |
| `waitPort` | `8643` | 拉起前等待的端口（0 = 不等） |
| `waitPortTimeoutMs` | `30000` | 等待超时 |
| `gracefulShutdownMs` | `5000` | 终止宽限 |
| `restartOnExit` | `true` | 意外退出时重启 |
| `maxRestarts` | `3` | 重启上限 |
| `restartDelayMs` | `3000` | 重启延迟 |

## 它做了什么

1. 校验 NapCat 目录里 5 个必需文件存在
2. 等待 `waitPort`（默认 8643，即 dsh-onebot 的反向 WS 端口）就绪
3. 通过 `ctx.subprocess.spawn` 启动 `NapCatWinBootMain.exe`，带上 Shell launcher 会设的 5 个 `NAPCAT_*` 环境变量
4. 监听 `done`，意外退出时按配置重启（带上限，防重启风暴）
5. 插件卸载 / 宿主退出时 `terminate()` + `waitForExit()`

## 前置

- Windows（NapCat Shell 形态）
- QQ NT 已安装
- 已解压 [NapCat.Shell](https://github.com/NapNeko/NapCatQQ/releases)
- 配好 NapCat 的 OneBot 11 反向 WS（指向 dsh-onebot 的端口）

## 许可

MIT
