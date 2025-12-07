/*
 * GPT分区表解析工具 -- by zhlhlf
 * 解析GPT分区表并生成9008刷机包的XML配置文件
 * 
 * 功能:
 * 1. 解析GPT Header和分区条目
 * 2. 提取所有分区信息(名称、起始位置、大小等)
 * 3. 生成rawprogram0.xml用于9008刷机
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>

#ifdef _WIN32
#define PACKED
#pragma pack(push, 1)
#else
#define PACKED __attribute__((packed))
#endif

#define GPT_SIZE (256 * 1024)  // 256KB
// #define SECTOR_SIZE 512  <-- Removed constant
#define MAX_PARTITIONS 256

// GPT Header结构
typedef struct {
    char signature[8];        // "EFI PART"
    uint32_t revision;
    uint32_t header_size;
    uint32_t header_crc32;
    uint32_t reserved;
    uint64_t current_lba;
    uint64_t backup_lba;
    uint64_t first_usable_lba;
    uint64_t last_usable_lba;
    uint8_t disk_guid[16];
    uint64_t partition_entry_lba;
    uint32_t num_partition_entries;
    uint32_t partition_entry_size;
    uint32_t partition_array_crc32;
} PACKED GPT_Header;

// GPT分区条目结构 (128字节)
typedef struct {
    uint8_t partition_type_guid[16];
    uint8_t unique_partition_guid[16];
    uint64_t starting_lba;
    uint64_t ending_lba;
    uint64_t attributes;
    uint16_t partition_name[36];  // UTF-16LE编码的分区名
} PACKED GPT_Partition_Entry;

#ifdef _WIN32
#pragma pack(pop)
#endif

// 分区信息结构(用于存储解析后的数据)
typedef struct {
    char name[73];           // 分区名称(转换为UTF-8)
    uint64_t start_lba;      // 起始LBA
    uint64_t end_lba;        // 结束LBA
    uint64_t size_sectors;   // 大小(扇区数)
    uint64_t size_kb;        // 大小(KB)
    int is_valid;            // 是否有效
} Partition_Info;

// 将UTF-16LE转换为UTF-8/ASCII
void utf16le_to_utf8(const uint16_t *utf16, char *utf8, size_t max_len) {
    size_t i;
    for (i = 0; i < max_len - 1 && utf16[i] != 0; i++) {
        // 简化处理: 只处理ASCII范围内的字符
        if (utf16[i] < 128) {
            utf8[i] = (char)utf16[i];
        } else {
            utf8[i] = '?';  // 非ASCII字符用?代替
        }
    }
    utf8[i] = '\0';
}

// 检查分区条目是否有效(非全零)
int is_partition_valid(const GPT_Partition_Entry *entry) {
    const uint8_t *ptr = (const uint8_t *)entry;
    for (size_t i = 0; i < sizeof(GPT_Partition_Entry); i++) {
        if (ptr[i] != 0) return 1;
    }
    return 0;
}

// 打印GPT Header信息
void print_gpt_header(const GPT_Header *gpt) {
    printf("========== GPT Header Info ==========\n");
    printf("Signature: %.8s\n", gpt->signature);
    printf("Revision: 0x%08X\n", gpt->revision);
    printf("Header size: %u bytes\n", gpt->header_size);
    printf("Current LBA: %llu\n", (unsigned long long)gpt->current_lba);
    printf("Backup LBA: %llu\n", (unsigned long long)gpt->backup_lba);
    printf("First usable LBA: %llu\n", (unsigned long long)gpt->first_usable_lba);
    printf("Last usable LBA: %llu\n", (unsigned long long)gpt->last_usable_lba);
    printf("Partition entry LBA: %llu\n", (unsigned long long)gpt->partition_entry_lba);
    printf("Number of entries: %u\n", gpt->num_partition_entries);
    printf("Entry size: %u bytes\n", gpt->partition_entry_size);
    printf("=====================================\n\n");
}

// 打印分区信息表格
void print_partition_table(const Partition_Info *partitions, int count, uint32_t sector_size) {
    printf("\n========== Partition Table ==========\n");
    printf("%-4s %-20s %-12s %-12s %-12s %-10s\n", 
           "No.", "Name", "Start LBA", "End LBA", "Sectors", "Size(KB)");
    printf("--------------------------------------------------------------------------------\n");
    
    for (int i = 0; i < count; i++) {
        if (partitions[i].is_valid) {
            printf("%-4d %-20s %-12llu %-12llu %-12llu %-10llu\n",
                   i + 1,
                   partitions[i].name,
                   (unsigned long long)partitions[i].start_lba,
                   (unsigned long long)partitions[i].end_lba,
                   (unsigned long long)partitions[i].size_sectors,
                   (unsigned long long)(partitions[i].size_sectors * sector_size) / 1024);
        }
    }
    printf("================================================================================\n\n");
}

// 生成rawprogram0.xml文件
int generate_rawprogram_xml(const Partition_Info *partitions, int count, const char *filename, int physical_partition, uint32_t sector_size) {
    FILE *xml_file = fopen(filename, "w");
    if (!xml_file) {
        fprintf(stderr, "ERROR: Cannot create XML file '%s'\n", filename);
        return -1;
    }

    // 获取当前时间
    time_t now = time(NULL);
    struct tm *t = localtime(&now);
    char time_str[64];
    strftime(time_str, sizeof(time_str), "%Y-%m-%d %H:%M:%S", t);

    fprintf(xml_file, "<?xml version=\"1.0\" ?>\n");
    fprintf(xml_file, "<data>\n");
    fprintf(xml_file, "  <!--\n");
    fprintf(xml_file, "    Auto-generated 9008 flash configuration  - by zhlhlf\n");
    fprintf(xml_file, "    Generated: %s\n", time_str);
    fprintf(xml_file, "    Physical partition number: %d\n", physical_partition);
    fprintf(xml_file, "    Sector Size: %u bytes\n", sector_size);
    fprintf(xml_file, "    \n");
    fprintf(xml_file, "    Usage:\n");
    fprintf(xml_file, "    1. Prepare partition image files (.img)\n");
    fprintf(xml_file, "    2. Name files as: partition_name.img\n");
    fprintf(xml_file, "    3. Use QFIL tool to flash with this config\n");
    fprintf(xml_file, "  -->\n\n");

    // 第一行：刷写GPT分区表（前34个扇区，包含保护MBR、GPT Header和分区条目）
    // 注意：如果扇区大小是4096，通常GPT Header在LBA 1，Entries在LBA 2。
    // 34个扇区是针对512字节扇区的标准（1 MBR + 1 Header + 32 Entries）。
    // 对于4096字节扇区，通常只需要 1 (MBR) + 1 (Header) + 1 (Entries, 32*128=4096) = 3个扇区？
    // 或者保留34个扇区也没问题，只是多写了一些数据。
    // 为了安全起见，我们保留 num_partition_sectors="34" 或者是根据实际大小计算？
    // 标准GPT entries通常是16KB (128 entries * 128 bytes).
    // 这里我们读取了 num_partition_entries。
    
    // 简单起见，我们还是写34个扇区，或者根据 sector_size 调整。
    // 如果 sector_size=4096，34个扇区 = 136KB。
    
    fprintf(xml_file, "  <program filename=\"gpt_main%d.bin\" label=\"PrimaryGPT\" SECTOR_SIZE_IN_BYTES=\"%u\" file_sector_offset=\"0\" num_partition_sectors=\"34\" physical_partition_number=\"%d\" start_sector=\"0\" />\n", 
            physical_partition, sector_size, physical_partition);
    fprintf(xml_file, "\n");

    for (int i = 0; i < count; i++) {
        if (partitions[i].is_valid && partitions[i].size_sectors > 0) {
            fprintf(xml_file, "  <program filename=\"%s.img\" label=\"%s\" SECTOR_SIZE_IN_BYTES=\"%u\" file_sector_offset=\"0\" num_partition_sectors=\"%llu\" physical_partition_number=\"%d\" start_sector=\"%llu\" />\n",
                    partitions[i].name,
                    partitions[i].name,
                    sector_size,
                    (unsigned long long)partitions[i].size_sectors,
                    physical_partition,
                    (unsigned long long)partitions[i].start_lba);
        }
    }

    fprintf(xml_file, "</data>\n");
    fclose(xml_file);
    
    printf("=> XML file generated: %s\n", filename);
    return 0;
}

int main(int argc, char *argv[]) {
    FILE *input_file = NULL;
    unsigned char *buffer = NULL;
    size_t bytes_read;
    int ret = 0;
    Partition_Info partitions[MAX_PARTITIONS] = {0};
    int partition_count = 0;
    int physical_partition = 0;  // 默认为0
    uint32_t sector_size = 512;  // 默认512，会根据GPT Header自动检测

#ifdef _WIN32
    // 设置Windows控制台为UTF-8编码
    system("chcp 65001 >nul");
#endif

    printf("GPT Partition Table Parser v2.1 by zhlhlf\n");
    printf("======================================\n\n");

    // 检查命令行参数
    if (argc < 2) {
        printf("Usage: %s <GPT_file> [physical_partition_number] [output_XML]\n", argv[0]);
        printf("Example: %s gpt_main4.bin 4\n", argv[0]);
        printf("Example: %s gpt_main4.bin 4 rawprogram4.xml\n", argv[0]);
        printf("\nDefault physical_partition_number: 0\n");
        printf("Default output: rawprogram0.xml\n");
        return 1;
    }

    const char *input_filename = argv[1];
    
    // 解析physical_partition_number（第2个参数）
    if (argc >= 3) {
        physical_partition = atoi(argv[2]);
    }
    
    // 解析输出文件名（第3个参数），如果没有则自动生成
    const char *xml_filename;
    char auto_filename[256];
    if (argc >= 4) {
        xml_filename = argv[3];
    } else {
        snprintf(auto_filename, sizeof(auto_filename), "rawprogram%d.xml", physical_partition);
        xml_filename = auto_filename;
    }
    
    printf("Input file: %s\n", input_filename);
    printf("Physical partition number: %d\n", physical_partition);
    printf("Output XML: %s\n\n", xml_filename);

    // 分配缓冲区
    buffer = (unsigned char *)malloc(GPT_SIZE);
    if (!buffer) {
        fprintf(stderr, "ERROR: Memory allocation failed!\n");
        return 1;
    }

    // 打开输入文件
    input_file = fopen(input_filename, "rb");
    if (!input_file) {
        fprintf(stderr, "ERROR: Cannot open input file '%s'\n", input_filename);
        ret = 1;
        goto cleanup;
    }

    // 读取前256KB
    printf("Reading GPT partition table data...\n");
    bytes_read = fread(buffer, 1, GPT_SIZE, input_file);
    if (bytes_read < 1024) { // 至少需要两个扇区(512*2)
        fprintf(stderr, "ERROR: File too small to contain valid GPT!\n");
        ret = 1;
        goto cleanup;
    }

    // 搜索GPT Header的"EFI PART"签名
    // 标准位置是LBA 1(偏移512字节),但某些设备可能不同
    GPT_Header *gpt = NULL;
    size_t gpt_offset = 0;
    
    printf("Searching for GPT Header signature...\n");
    // 以512字节为步长搜索
    for (size_t offset = 0; offset < bytes_read - sizeof(GPT_Header); offset += 512) {
        GPT_Header *test_gpt = (GPT_Header *)(buffer + offset);
        if (memcmp(test_gpt->signature, "EFI PART", 8) == 0) {
            gpt = test_gpt;
            gpt_offset = offset;
            printf("=> Found GPT Header at offset: %zu bytes (0x%zX)\n", offset, offset);
            
            // 自动检测扇区大小
            if (gpt->current_lba > 0) {
                sector_size = (uint32_t)(offset / gpt->current_lba);
                printf("=> Detected Sector Size: %u bytes\n", sector_size);
            } else {
                printf("=> Warning: Current LBA is 0, assuming Sector Size: 512 bytes\n");
                sector_size = 512;
            }
            break;
        }
    }
    
    if (!gpt) {
        fprintf(stderr, "ERROR: Valid GPT signature not found!\n");
        printf("Searched range: 0 - %zu bytes\n", bytes_read);
        ret = 1;
        goto cleanup;
    }

    printf("=> Valid GPT partition table detected!\n\n");
    print_gpt_header(gpt);

    // 解析分区条目
    printf("Parsing partition entries...\n");
    
    // 计算分区条目数组的偏移位置
    // 使用GPT Header中的partition_entry_lba进行精确计算
    size_t partition_array_offset;
    
    // 计算当前文件起始位置对应的LBA
    // 假设找到的GPT Header位于 gpt->current_lba
    int64_t buffer_start_lba = (int64_t)gpt->current_lba - (gpt_offset / sector_size);
    
    if (buffer_start_lba < 0) {
        printf("Warning: Calculated start LBA is negative, assuming 0.\n");
        buffer_start_lba = 0;
    }

    // 计算分区表相对于文件起始位置的偏移
    int64_t entry_lba_relative = (int64_t)gpt->partition_entry_lba - buffer_start_lba;
    
    if (entry_lba_relative < 0) {
        // 如果计算出的位置在文件之前，尝试回退到旧逻辑（紧跟Header之后）
        printf("Warning: Partition entries LBA seems to be before file start. Fallback to next sector.\n");
        partition_array_offset = gpt_offset + sector_size;
    } else {
        partition_array_offset = (size_t)(entry_lba_relative * sector_size);
    }

    printf("Partition Entry LBA: %llu\n", (unsigned long long)gpt->partition_entry_lba);
    printf("Calculated Partition Array Offset: %zu bytes\n", partition_array_offset);
    
    // 确保不超出缓冲区
    if (partition_array_offset >= bytes_read) {
        fprintf(stderr, "ERROR: Partition entry array position exceeds file size!\n");
        ret = 1;
        goto cleanup;
    }
    
    printf("Partition entry array offset: %zu bytes (0x%zX)\n", partition_array_offset, partition_array_offset);
    
    for (uint32_t i = 0; i < gpt->num_partition_entries && i < MAX_PARTITIONS; i++) {
        size_t entry_offset = partition_array_offset + i * gpt->partition_entry_size;
        
        // 边界检查：确保不读取超出缓冲区的数据
        if (entry_offset + gpt->partition_entry_size > bytes_read) {
            printf("Warning: Reached end of file data at entry %d. Stopping.\n", i);
            break;
        }

        GPT_Partition_Entry *entry = (GPT_Partition_Entry *)(buffer + entry_offset);
        
        if (is_partition_valid(entry)) {
            utf16le_to_utf8(entry->partition_name, partitions[partition_count].name, 73);
            partitions[partition_count].start_lba = entry->starting_lba;
            partitions[partition_count].end_lba = entry->ending_lba;
            partitions[partition_count].size_sectors = entry->ending_lba - entry->starting_lba + 1;
            partitions[partition_count].size_kb = (partitions[partition_count].size_sectors * sector_size) / 1024;
            partitions[partition_count].is_valid = 1;
            partition_count++;
        }
    }

    printf("=> Successfully parsed %d partitions\n", partition_count);
    
    // 打印分区表
    print_partition_table(partitions, partition_count, sector_size);

    // 生成XML文件
    printf("Generating 9008 flash configuration file...\n");
    if (generate_rawprogram_xml(partitions, partition_count, xml_filename, physical_partition, sector_size) != 0) {
        ret = 1;
        goto cleanup;
    }

    printf("\n======================================\n");
    printf("Parsing completed!\n");
    printf("======================================\n\n");
    printf("Generated files:\n");
    printf("  - %s (%d partitions + GPT header)\n\n", xml_filename, partition_count);
    printf("Next steps:\n");
    printf("  1. Prepare partition image files (.img)\n");
    printf("  2. Prepare prog_emmc_firehose.mbn file\n");
    printf("  3. Use QFIL tool to flash\n\n");

cleanup:
    if (buffer) free(buffer);
    if (input_file) fclose(input_file);

    return ret;
}
