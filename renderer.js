const devprgInput = document.getElementById('devprg-path');
const digestInput = document.getElementById('digest-path');
const sigInput = document.getElementById('sig-path');
const xmlInput = document.getElementById('xml-path');
const portDisplay = document.getElementById('port-display');
const logsDiv = document.getElementById('logs');
const xmlSection = document.getElementById('xml-section');
const xmlPreview = document.getElementById('xml-preview');
const xmlTableBody = document.querySelector('#xml-table tbody');
const xmlSearchInput = document.getElementById('xml-search-input');
const toastContainer = document.getElementById('toast-container');

function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  
  toastContainer.appendChild(toast);
  
  // Trigger reflow
  void toast.offsetWidth;
  
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300); // Wait for transition to finish
  }, duration);
}

let currentPort = null;

function logRaw(message) {
  const span = document.createElement('span');
  span.textContent = message;
  logsDiv.appendChild(span);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

function log(message) {
  logRaw(message + '\n');
}

window.api.onLog((message) => {
  logRaw(message);
});

window.api.onPortUpdate((port) => {
  if (port) {
    currentPort = port;
    portDisplay.textContent = port;
    // Only log if it's a new connection or change
    // log(`Device connected on ${port}`); 
  } else {
    currentPort = null;
    portDisplay.textContent = '未发现设备';
    // log('Device disconnected');
  }
});

async function findPort() {
  // Manual check still useful for initial load
  portDisplay.textContent = '搜索中...';
  const port = await window.api.findPort();
  if (port) {
    currentPort = port;
    portDisplay.textContent = port;
    log(`已发现设备：${port}`);
  } else {
    currentPort = null;
    portDisplay.textContent = '未发现设备';
  }
}

document.getElementById('refresh-port').addEventListener('click', findPort);

document.getElementById('clear-logs-btn').addEventListener('click', () => {
  logsDiv.innerHTML = '';
});

let selectedXmlFiles = [];
let parsedXmlData = [];
let preservedPatches = []; // Store patch files content for later use
let isXmlParsed = false; // Flag to track if XML has been parsed

const xmlOperationConfigs = {
  run: {
    mode: 'run',
    logPrefix: '执行 XML 写入，文件：',
    successLog: 'XML 写入完成。',
    errorPrefix: '执行 XML 写入出错'
  },
  read: {
    mode: 'read',
    logPrefix: '按 XML 读取，文件：',
    successLog: '读取完成。',
    errorPrefix: '读取过程中出错'
  }
};

function resolveXmlFiles() {
  if (selectedXmlFiles.length > 0) {
    return [...selectedXmlFiles];
  }
  if (xmlInput.value) {
    return [xmlInput.value];
  }
  return [];
}

function getDirName(filePath) {
  if (!filePath) return '';
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) return '';
  return filePath.substring(0, lastSlash);
}

async function handleXmlOperation(mode) {
  if (!currentPort) {
    showToast('请先连接设备。');
    return;
  }

  const normalizedMode = (mode || 'run').toLowerCase();
  const operation = xmlOperationConfigs[normalizedMode] || xmlOperationConfigs.run;

  let filesToRun = [];
  let searchPath = null;

  // Always try to generate XML from selection for both read and write
  if (!isXmlParsed || parsedXmlData.length === 0) {
    // Try to resolve from input if not parsed yet
    const inputFiles = resolveXmlFiles();
    if (inputFiles.length > 0) {
      await parseAndDisplayXml(inputFiles, false); // Parse silently
    } else {
      showToast('请选择 XML 文件并确保列表已加载。');
      return;
    }
  }
  let selectedItems = []
  selectedItems = parsedXmlData.filter(item => item.selected)

  // Filter selected items
  if (normalizedMode === 'run') {
    selectedItems = selectedItems.filter(item => item.attributes['filename'] && item.attributes['filename'].trim() !== '')
  } else {
    selectedItems.forEach(item => {
      item.attributes['filename'] = `${item.attributes['label']}.img`
    });
  }
  log(`已选择 ${selectedItems.length} 个分区进行操作。`);

  if (selectedItems.length === 0) {
    showToast('请至少勾选一个要操作的分区。');
    return;
  }

  // Determine searchPath from the first selected item's original file
  if (selectedItems.length > 0) {
    searchPath = getDirName(selectedItems[0].file);
  }

  // Generate XML content
  log(`正在为 ${normalizedMode === 'run' ? '写入' : '读取'} 操作生成 XML...`);
  const xmlContent = generateXmlContent(selectedItems, normalizedMode);

  // Save to a temporary file
  try {
    const tempXmlPath = await window.api.saveTempXml(xmlContent);
    filesToRun = [tempXmlPath];
    log(`已生成临时 XML 文件用于操作：${tempXmlPath} `);
  } catch (err) {
    log(`生成临时 XML 失败：${err} `);
    return;
  }

  if (filesToRun.length === 0) {
    showToast('请选择 XML 文件。');
    return;
  }

  const fileNames = filesToRun.map((f) => f.split(/[\\/]/).pop()).join(', ');
  log(`${operation.logPrefix}${fileNames} `);

  const result = await window.api.executeXml({
    port: currentPort,
    xmlPath: filesToRun,
    searchPath: searchPath,
    mode: operation.mode
  });

  if (result.success) {
    log(operation.successLog);
  } else {
    log(`${operation.errorPrefix}：${result.error} `);
  }
}

async function selectFile(inputElement, multiple = false) {
  const result = await window.api.selectFile({ multiple });
  if (result) {
    if (multiple && Array.isArray(result) && result.length > 0) {
      return result;
    } else if (!multiple && typeof result === 'string') {
      if (inputElement) {
        inputElement.value = result;
      }
      return result;
    }
  }
  return null;
}

function setupDragAndDrop(element, inputElement, multiple = false) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.style.borderColor = '#0078d4';
    element.style.backgroundColor = '#f0f8ff';
  });

  element.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.style.borderColor = '#ccc';
    element.style.backgroundColor = 'white';
  });

  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.style.borderColor = '#ccc';
    element.style.backgroundColor = 'white';

    if (e.dataTransfer.files.length > 0) {
      if (multiple) {
        const files = Array.from(e.dataTransfer.files).map(f => f.path);
        selectedXmlFiles = files;
        inputElement.value = files.map(f => f.split(/[\\/]/).pop()).join(', ');
      } else {
        const path = e.dataTransfer.files[0].path;
        inputElement.value = path;
      }
    }
  });
}

// Setup drag and drop for inputs
setupDragAndDrop(devprgInput, devprgInput);
setupDragAndDrop(digestInput, digestInput);
setupDragAndDrop(sigInput, sigInput);
setupDragAndDrop(xmlInput, xmlInput, true);

devprgInput.addEventListener('click', () => selectFile(devprgInput));
digestInput.addEventListener('click', () => selectFile(digestInput));
sigInput.addEventListener('click', () => selectFile(sigInput));
xmlInput.addEventListener('click', async () => {
  const files = await selectFile(xmlInput, true);
  if (files) {
    selectedXmlFiles = files;
    xmlInput.value = files.map(f => f.split(/[\\/]/).pop()).join(', ');
    isXmlParsed = false; // Reset flag when new files are selected
    await parseAndDisplayXml(files, false); // Parse immediately but don't show modal
  }
});

const xmlPreviewModal = document.getElementById('xml-preview-modal');

// Close modal when clicking outside
window.addEventListener('click', (event) => {
  if (event.target === xmlPreviewModal) {
    xmlPreviewModal.style.display = 'none';
  }
});

document.getElementById('show-xml-list-btn').addEventListener('click', () => {
  if (isXmlParsed) {
    xmlPreviewModal.style.display = 'block'; // Just show the modal if already parsed
  } else {
    const files = resolveXmlFiles();
    if (files.length > 0) {
      parseAndDisplayXml(files, true);
    } else {
      showToast('请先选择 XML 文件。');
    }
  }
});

document.getElementById('select-all-xml').addEventListener('change', (e) => {
  const checked = e.target.checked;
  parsedXmlData.forEach(item => item.selected = checked);
  // Update UI
  const checkboxes = xmlTableBody.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = checked);
});

async function parseAndDisplayXml(filePaths, showModal = true) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  xmlTableBody.innerHTML = ''; // Clear table
  if (showModal) {
    xmlPreviewModal.style.display = 'block'; // Show modal
  }
  log(`开始解析 XML 文件`);
  parsedXmlData = []; // Reset data
  preservedPatches = []; // Reset patches

  for (const filePath of paths) {
    log(`读取 XML：${filePath} `);
    const result = await window.api.readFileContent(filePath);

    if (!result.success) {
      log(`读取文件出错：${result.error} `);
      continue;
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(result.content, "text/xml");

      // Try to find 'program' tags
      const programs = xmlDoc.getElementsByTagName('program');

      if (programs.length > 0) {

        for (let i = 0; i < programs.length; i++) {
          const prog = programs[i];

          // Extract all attributes
          const attributes = {};
          for (let j = 0; j < prog.attributes.length; j++) {
            const attr = prog.attributes[j];
            attributes[attr.name] = attr.value;
          }

          const label = attributes['label'] || '-';
          const filename = attributes['filename'] || '';
          const numSectors = attributes['num_partition_sectors'] || 0;
          console.log(`${label} ${numSectors} `);
          let sizeKB;
          if (numSectors !== '-' && !isNaN(numSectors)) {
            sizeKB = parseInt(numSectors) * 4;
          }

          // Logic for default selection: if filename is present, select it
          const isSelected = filename && filename.trim() !== '';

          // Store data
          const dataItem = {
            file: filePath,
            attributes: attributes,
            selected: isSelected
          };
          parsedXmlData.push(dataItem);

          const row = document.createElement('tr');

          const tdCheck = document.createElement('td');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = isSelected;
          checkbox.addEventListener('change', (e) => {
            dataItem.selected = e.target.checked;
          });
          tdCheck.appendChild(checkbox);

          const tdLabel = document.createElement('td');
          const labelSpan = document.createElement('span');
          labelSpan.className = 'table-text-chip';
          labelSpan.textContent = label;
          tdLabel.appendChild(labelSpan);

          const tdFilename = document.createElement('td');
          const filenameSpan = document.createElement('span');
          filenameSpan.className = 'table-text-chip filename-chip';
          filenameSpan.textContent = filename;
          tdFilename.appendChild(filenameSpan);
          
          tdFilename.style.cursor = 'pointer';
          tdFilename.title = '点击选择文件';
          tdFilename.addEventListener('click', async () => {
            const newFile = await selectFile(null, false); // Pass null as input element to just get path
            if (newFile) {
              filenameSpan.textContent = newFile.split(/[\\/]/).pop(); // Show only filename
              attributes['filename'] = newFile; // Update stored attribute
              // Also update the full path if needed, or just keep filename relative/absolute as per logic
              // Assuming we want to store the full path for XML generation later
              dataItem.attributes['filename'] = newFile;

              // Auto-select the row if a file is chosen
              if (!checkbox.checked) {
                checkbox.checked = true;
                dataItem.selected = true;
              }
            }
          });

          const tdSize = document.createElement('td');
          const sizeSpan = document.createElement('span');
          sizeSpan.className = 'table-text-chip';
          sizeSpan.textContent = sizeKB;
          tdSize.appendChild(sizeSpan);

          row.appendChild(tdCheck);
          row.appendChild(tdLabel);
          row.appendChild(tdFilename);
          row.appendChild(tdSize);

          xmlTableBody.appendChild(row);
        }
        log(`解析到 ${programs.length} 个 program 条目（来自 ${filePath}）。`);
      } else {
        // ... patch logic ...
        const patches = xmlDoc.getElementsByTagName('patch');
        if (patches.length > 0) {
          // Store patch content for later use
          // We store the raw string content of the patch tags or the whole file content if it's a patch-only file
          // For simplicity, let's store the file path and we can re-read or store the parsed structure
          // The user said "put into a global variable", so we store the file path or content.
          // Let's store the file path and the parsed attributes for flexibility.

          for (let i = 0; i < patches.length; i++) {
            const patch = patches[i];
            const attributes = {};
            for (let j = 0; j < patch.attributes.length; j++) {
              const attr = patch.attributes[j];
              attributes[attr.name] = attr.value;
            }
            preservedPatches.push({
              file: filePath,
              attributes: attributes,
              rawContent: patch.outerHTML // Store the raw XML string of the patch tag
            });
          }

          log(`解析到 ${patches.length} 个 patch 条目（来自 ${filePath}，已保存）。`);

          // If this is the only file and it's a patch file, we might want to hide the table if it was empty
          // But if we have multiple files, we keep the table visible for others.
          if (paths.length === 1) {
            // xmlPreview.style.display = 'none';
          }
        } else {
          if (paths.length === 1) {
            // xmlPreview.style.display = 'none';
            log('未在 XML 中找到 <program> 或 <patch> 标签。');
          }
        }
      }
    } catch (e) {
      log(`解析 XML 出错 ${filePath}：${e.message} `);
    }
  }
  isXmlParsed = true;
}

document.getElementById('start-btn').addEventListener('click', async () => {
  if (!currentPort) {
    showToast('请先连接设备。');
    return;
  }
  if (!devprgInput.value) {
    showToast('请选择必须的 devprg 文件。');
    return;
  }

  log('开始初始化...');
  const result = await window.api.startProcess({
    port: currentPort,
    devprg: devprgInput.value,
    digest: digestInput.value,
    sig: sigInput.value
  });

  if (result.success) {
    log('初始化成功！');
    // xmlSection.style.opacity = '1'; // No longer needed
    // xmlSection.style.pointerEvents = 'auto'; // No longer needed
    showToast('初始化成功！现在可以执行 XML 命令。');
  } else {
    log(`错误：${result.error} `);
    showToast(`初始化失败：${result.error} `);
  }
});

document.querySelectorAll('[data-xml-mode]').forEach((button) => {
  button.addEventListener('click', (event) => {
    handleXmlOperation(event.currentTarget.dataset.xmlMode);
  });
});

async function handleReboot(mode) {
  if (!currentPort) {
    showToast('请先连接设备。');
    return;
  }
  log(`尝试重启到 ${mode}...`);
  const result = await window.api.rebootDevice({ port: currentPort, mode });
  if (result.success) {
    log(`重启指令已发送（${mode}）。`);
  } else {
    log(`重启失败：${result.error} `);
  }
}

document.getElementById('reboot-btn').addEventListener('click', () => handleReboot('reboot'));
document.getElementById('reboot-recovery-btn').addEventListener('click', () => handleReboot('recovery'));
document.getElementById('reboot-fastboot-btn').addEventListener('click', () => handleReboot('fastboot'));
document.getElementById('reboot-edl-btn').addEventListener('click', () => handleReboot('edl'));

document.getElementById('read-gpt-btn').addEventListener('click', async () => {
  if (!currentPort) {
    showToast('请先连接设备。');
    return;
  }
  log('正在从所有 LUN 读取分区表...');
  log('这可能需要几分钟...\n');

  const result = await window.api.readGPT({ port: currentPort });

  if (result.success) {
    log(`\n✓ 分区表读取成功！`);
    log(`✓ 已处理 ${result.lunsRead} 个 LUN`);
    showToast(`GPT 读取完成！已处理 ${result.lunsRead} 个 LUN。`);
  } else {
    log(`\n✗ 读取分区表出错：${result.error} \n`);
    showToast(`读取分区表失败：${result.error} `);
  }
});


async function loadDefaultFiles() {
  try {
    const files = await window.api.getDefaultFiles();
    devprgInput.value = files.devprg;
    digestInput.value = files.digest;
    sigInput.value = files.sig;
  } catch (error) {
    log(`加载默认文件出错：${error.message} `);
  }
}

findPort();
loadDefaultFiles();

// About Modal Logic
const aboutBtn = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');

if (aboutBtn && aboutModal) {
  aboutBtn.addEventListener('click', () => {
    aboutModal.style.display = 'block';
  });

  window.addEventListener('click', (event) => {
    if (event.target == aboutModal) {
      aboutModal.style.display = 'none';
    }
  });
}

xmlSearchInput.addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase();
  const rows = xmlTableBody.getElementsByTagName('tr');

  for (let row of rows) {
    // Skip file header rows (they have colspan)
    if (row.cells.length === 1 && row.cells[0].hasAttribute('colspan')) {
      continue;
    }

    // Data rows have 4 cells: Checkbox, Label, Filename, Size
    if (row.cells.length >= 2) {
      const labelCell = row.cells[1];
      if (labelCell) {
        const labelText = labelCell.textContent.toLowerCase();
        if (labelText.includes(searchTerm)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      }
    }
  }
});

function generateXmlContent(selectedItems, mode) {
  let xmlContent = '<?xml version="1.0" ?>\n<data>\n';

  // Add program tags
  selectedItems.forEach(item => {
    let line = '  <program';
    for (const [key, value] of Object.entries(item.attributes)) {
      line += ` ${key}="${value}"`;
    }
    line += ' />';
    xmlContent += line + '\n';
  });

  // Add preserved patches ONLY for 'run' mode
  if (mode === 'run' && preservedPatches.length > 0) {
    log(`正在添加 ${preservedPatches.length} 个 patch 标签...`);
    preservedPatches.forEach(patch => {
      let line = '  <patch';
      for (const [key, value] of Object.entries(patch.attributes)) {
        line += ` ${key}="${value}"`;
      }
      line += ' />';
      xmlContent += line + '\n';
    });
  }

  xmlContent += '</data>';
  return xmlContent;
}
