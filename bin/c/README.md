# GPT分区表解析工具与9008刷机包生成器

## 项目说明

本工具用于解析手机GPT分区表,提取所有分区信息,并自动生成9008模式刷机所需的XML配置文件。

## 功能特性

✅ **完整解析GPT分区表**: 解析GPT Header和所有分区条目  
✅ **提取分区信息**: 自动提取分区名称、起始位置、大小等信息  
✅ **生成XML配置**: 自动生成包含所有分区的rawprogram0.xml  
✅ **友好的信息展示**: 以表格形式显示所有分区详情  
✅ **跨平台支持**: Windows/Linux/macOS通用  

## 文件说明

- `extract_gpt.c` - GPT分区表解析工具源代码
- `gpt_main4.bin` - 原始GPT分区表数据文件(SDE分区前24KB)
- `build_and_run.bat` - Windows自动编译运行脚本
- `patch0.xml` - 9008刷机补丁文件(可选)
- `rawprogram0.xml` - 生成的9008刷机配置文件(运行程序后生成)

## 快速开始

### 方法1: 使用批处理脚本(Windows推荐)

直接双击运行 `build_and_run.bat`,脚本将自动:
1. 检测并使用可用的编译器(GCC或MSVC)
2. 编译C程序
3. 解析GPT分区表
4. 生成包含所有分区的XML配置文件

### 方法2: 手动操作

#### 步骤1: 编译程序

**Windows (MinGW GCC):**
```powershell
gcc extract_gpt.c -o extract_gpt.exe
```

**Windows (MSVC - Visual Studio开发者命令提示符):**
```powershell
cl extract_gpt.c
```

**Linux / macOS:**
```bash
gcc extract_gpt.c -o extract_gpt
```

#### 步骤2: 运行解析程序

**Windows:**
```powershell
.\extract_gpt.exe gpt_main4.bin

# 或指定输出XML文件名
.\extract_gpt.exe gpt_main4.bin my_rawprogram.xml
```

**Linux / macOS:**
```bash
./extract_gpt gpt_main4.bin
```

## 程序输出示例

程序运行后会显示:

```
GPT分区表解析工具 v2.0
======================================

正在读取GPT分区表数据...
✓ 检测到有效的GPT分区表!

========== GPT Header信息 ==========
签名: EFI PART
修订版本: 0x00010000
头部大小: 92 字节
当前LBA: 1
备份LBA: xxxxx
...
===================================

正在解析分区条目...
✓ 成功解析 XX 个分区

========== 分区表信息 ==========
序号 分区名称             起始LBA      结束LBA      扇区数       大小(KB)
--------------------------------------------------------------------------------
1    sbl1                34           1057         1024         512
2    boot                2048         67583        65536        32768
3    system              67584        4456447      4388864      2194432
...
================================================================================

正在生成9008刷机配置文件...
✓ 成功生成XML文件: rawprogram0.xml

======================================
解析完成!
======================================

生成的文件:
  - rawprogram0.xml (包含XX个分区的刷机配置)

下一步:
  1. 准备各分区的镜像文件(.img)
  2. 准备 prog_emmc_firehose.mbn 文件
  3. 使用QFIL工具进行刷机
```

## 生成的XML配置文件

`rawprogram0.xml` 包含所有分区的配置信息,格式如下:

```xml
<?xml version="1.0" ?>
<data>
  <program SECTOR_SIZE_IN_BYTES="512"
           file_sector_offset="0"
           filename="boot.img"
           label="boot"
           num_partition_sectors="65536"
           physical_partition_number="0"
           start_sector="2048" />

  <program SECTOR_SIZE_IN_BYTES="512"
           file_sector_offset="0"
           filename="system.img"
           label="system"
           num_partition_sectors="4388864"
           physical_partition_number="0"
           start_sector="67584" />
  
  <!-- 更多分区... -->
</data>
```

每个 `<program>` 标签对应一个分区,包含:
- `filename`: 分区镜像文件名(格式: 分区名.img)
- `label`: 分区标签名称
- `start_sector`: 起始扇区(LBA)
- `num_partition_sectors`: 分区大小(扇区数)

## 使用9008刷机

### 准备工作

1. **准备分区镜像文件**:
   - 根据生成的XML中的filename字段,准备对应的.img文件
   - 例如: `boot.img`, `system.img`, `recovery.img` 等
   - 如果只刷部分分区,可以手动编辑XML删除不需要的条目

2. **获取Firehose Programmer**:
   - 从设备厂商或ROM包中获取 `prog_emmc_firehose.mbn`
   - 必须与设备型号匹配,否则无法刷机

3. **准备刷机工具**:
   - Windows: QFIL (Qualcomm Flash Image Loader)
   - Linux: qdl 或 edl 工具

### 使用QFIL刷机(Windows)

1. **进入9008模式**:
   ```powershell
   # 如果设备已开机且ADB可用
   adb reboot edl
   
   # 或按设备特定组合键进入下载模式
   ```

2. **打开QFIL工具**:
   - Configuration → Firehose Configuration
   - Device Type: UFS/eMMC (根据实际设备)
   - Reset After Download: 勾选

3. **选择文件**:
   - Select Programmer: 选择 `prog_emmc_firehose.mbn`
   - Select Build Type: Flat Build
   - Load XML: 选择生成的 `rawprogram0.xml`
   - Load XML: 选择 `patch0.xml` (可选)

4. **开始刷机**:
   - 确保所有.img文件与XML在同一目录
   - 点击 "Download" 按钮
   - 等待刷机完成

### 使用EDL工具刷机(Linux)

```bash
# 安装edl工具
pip3 install edl

# 进入9008模式后执行
edl w boot boot.img
edl w system system.img
# ... 根据需要刷写其他分区

# 或使用XML配置批量刷写
edl xml rawprogram0.xml
```

## GPT分区表结构说明

GPT(GUID Partition Table)分区表的前24KB数据包含:

| 位置 | 大小 | 内容 |
|------|------|------|
| LBA 0 | 512字节 | 保护性MBR(Protective MBR) |
| LBA 1 | 512字节 | GPT Header(包含"EFI PART"签名) |
| LBA 2-33 | 16KB | GPT分区条目数组(通常128个条目×128字节) |

### GPT Header关键字段:
- `signature`: "EFI PART" (0x5452415020494645)
- `num_partition_entries`: 分区条目总数(通常128)
- `partition_entry_size`: 每个条目大小(通常128字节)
- `partition_entry_lba`: 分区条目起始LBA(通常为2)

### GPT分区条目字段:
- `partition_type_guid`: 分区类型GUID
- `unique_partition_guid`: 唯一分区GUID
- `starting_lba`: 起始逻辑块地址
- `ending_lba`: 结束逻辑块地址
- `partition_name`: 分区名称(UTF-16LE编码,最长36字符)

## 注意事项

⚠️ **重要警告**:

1. **备份数据**: 刷机前务必备份重要数据
2. **设备匹配**: 确保刷机包与目标设备型号匹配
3. **电量充足**: 刷机过程中保持设备电量充足(建议>50%)
4. **驱动安装**: Windows需要安装Qualcomm驱动
5. **Bootloader解锁**: 某些设备需要先解锁Bootloader
6. **风险警告**: 刷机有风险,操作不当可能导致设备变砖

## 常见问题

### Q1: 编译时出错?
**A**: 
- 确保已安装GCC编译器(Windows用户可安装MinGW-w64)
- 或使用Visual Studio自带的MSVC编译器
- 检查源代码是否完整,没有乱码

### Q2: 未检测到GPT签名?
**A**:
- 检查 `gpt_main4.bin` 文件是否正确
- GPT Header应该在偏移512字节处
- 使用十六进制编辑器查看偏移512处是否有 "EFI PART" 字符串
- 可能是备份GPT或文件损坏

### Q3: 刷机时QFIL报错?
**A**:
- 确认设备已进入9008/EDL模式(设备管理器显示Qualcomm HS-USB QDLoader 9008)
- 检查Qualcomm驱动是否正确安装
- 验证 `prog_emmc_firehose.mbn` 是否与设备匹配
- 检查.img文件是否存在且与XML中的filename一致

### Q4: 只想刷部分分区怎么办?
**A**:
- 用文本编辑器打开生成的 `rawprogram0.xml`
- 删除或注释掉不需要刷写的分区条目
- 只保留需要刷写的分区,如boot、system等

### Q5: 刷机后无法开机?
**A**:
- 检查是否刷入了正确的镜像文件
- 尝试重新刷入boot和system分区
- 如果有备份,恢复原始分区
- 寻求专业救砖服务

## 技术支持

使用前建议:
1. 使用十六进制编辑器(如HxD)查看 `gpt_main4.bin` 验证数据
2. 在虚拟机或测试设备上先试验
3. 详细记录原始分区表信息
4. 保存QFIL的日志文件以便排查问题

## 分区类型参考

常见的Android分区:
- `sbl1`, `sbl2`, `sbl3`: Secondary Bootloader
- `aboot`: Android Bootloader
- `boot`: 内核和ramdisk
- `recovery`: 恢复分区
- `system`: 系统分区
- `userdata`: 用户数据
- `cache`: 缓存分区
- `persist`: 持久化配置
- `modem`: 基带固件
- `tz`: TrustZone
- `rpm`: Resource Power Manager

## 版本历史

- **v2.0** (2025-12-07): 主要更新
  - ✅ 完整解析所有GPT分区条目
  - ✅ 自动生成包含所有分区的XML配置
  - ✅ 支持UTF-16LE分区名转换
  - ✅ 表格形式显示分区详情
  - ✅ 优化错误处理和提示

- **v1.0** (2025-12-07): 初始版本
  - 基础GPT提取功能

## 许可证

本工具仅供学习和研究使用。使用本工具造成的任何损失,作者不承担责任。

---

**免责声明**: 刷机有风险,操作需谨慎。本工具提供的功能仅用于教育和研究目的,请确保您了解相关风险并有足够的技术能力。对于因使用本工具导致的任何直接或间接损失,开发者不承担任何责任。
