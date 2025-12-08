# 9008 工具（Electron）

这是一个基于 Electron 的工具，用于对 Qualcomm 9008 模式设备进行操作，替代传统的批处理脚本。

## 前提条件

- 已安装 Node.js。
- `bin` 文件夹中必须包含所需的可执行文件（例如 `QSaharaServer.exe`、`fh_loader.exe`、`lsusb.exe` 等）。

## 安装与设置

1. 在此文件夹中打开终端。
2. 运行 `npm install` 来安装依赖（Electron）。

## 使用说明

1. 运行 `npm start` 启动应用。
2. 将设备连接到 9008 模式（Qualcomm HS-USB QDLoader 9008）。
3. 工具会自动检测端口（也可以点击“刷新端口”）。
4. 选择所需文件：
   - **DevPrg 文件**：程序员文件（例如 `prog_firehose_ddr.elf`）。
   - **Digest 文件**：摘要文件（digest）。
   - **Signature 文件**：签名文件（signature）。
5. 点击 **Connect & Initialize（连接并初始化）**。
   - 该操作会执行建立通信并解锁权限所需的步骤序列。
   - 可在“日志（Logs）”区域查看进度和输出信息。
6. 初始化完成后，“XML 操作（XML Operations）”部分将可用。
7. 选择一个 XML 文件（例如 `rawprogram0.xml` 或自定义的命令 XML），然后点击 **Run XML Command（运行 XML 命令）**。

## 常见问题与排查

- 如果无法检测到设备，请确认已安装相应驱动，并在设备管理器中显示为 “Qualcomm HS-USB QDLoader 9008”。
- 检查日志以获取来自底层工具的错误信息，以便进一步排查问题。
