const devprgInput = document.getElementById('devprg-path');
const digestInput = document.getElementById('digest-path');
const sigInput = document.getElementById('sig-path');
const xmlInput = document.getElementById('xml-path');
const portDisplay = document.getElementById('port-display');
const logsDiv = document.getElementById('logs');
const xmlSection = document.getElementById('xml-section');
const xmlPreview = document.getElementById('xml-preview');
const xmlTableBody = document.querySelector('#xml-table tbody');

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

async function handleXmlOperation(mode) {
  if (!currentPort) {
    alert('请先连接设备。');
    return;
  }

  const normalizedMode = (mode || 'run').toLowerCase();
  const operation = xmlOperationConfigs[normalizedMode] || xmlOperationConfigs.run;
  const filesToRun = resolveXmlFiles();

  if (filesToRun.length === 0) {
    alert('请选择 XML 文件。');
    return;
  }

  const fileNames = filesToRun.map((f) => f.split(/[\\/]/).pop()).join(', ');
  log(`${operation.logPrefix}${fileNames}`);

  const result = await window.api.executeXml({
    port: currentPort,
    xmlPath: filesToRun,
    mode: operation.mode
  });

  if (result.success) {
    log(operation.successLog);
  } else {
    log(`${operation.errorPrefix}：${result.error}`);
  }
}

async function selectFile(inputElement, multiple = false) {
  const result = await window.api.selectFile({ multiple });
  if (result) {
    if (multiple && Array.isArray(result) && result.length > 0) {
       return result;
    } else if (!multiple && typeof result === 'string') {
       inputElement.value = result;
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
        parseAndDisplayXml(files);
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
    parseAndDisplayXml(files);
  }
});

async function parseAndDisplayXml(filePaths) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  xmlTableBody.innerHTML = ''; // Clear table
  xmlPreview.style.display = 'none';

  for (const filePath of paths) {
      log(`读取 XML：${filePath}`);
      const result = await window.api.readFileContent(filePath);
      
      if (!result.success) {
        log(`读取文件出错：${result.error}`);
        continue;
      }

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(result.content, "text/xml");
        
        // Try to find 'program' tags
        const programs = xmlDoc.getElementsByTagName('program');
        
        if (programs.length > 0) {
          xmlPreview.style.display = 'block';
          
          // Add a header row for the file if multiple files
          if (paths.length > 1) {
             const fileRow = document.createElement('tr');
             fileRow.innerHTML = `<td colspan="3" style="background-color: #e1dfdd; font-weight: bold;">${filePath.split(/[\\/]/).pop()}</td>`;
             xmlTableBody.appendChild(fileRow);
          }

          for (let i = 0; i < programs.length; i++) {
            const prog = programs[i];
            const label = prog.getAttribute('label') || '-';
            const filename = prog.getAttribute('filename') || '';
            const numSectors = prog.getAttribute('num_partition_sectors') || '-';
            
            let sizeKB = '';
            if (numSectors !== '-' && !isNaN(numSectors)) {
              sizeKB = parseInt(numSectors) * 4;
            }

            const row = document.createElement('tr');
            row.innerHTML = `
              <td>${label}</td>
              <td>${filename}</td>
              <td>${sizeKB}</td>
            `;
            xmlTableBody.appendChild(row);
          }
          log(`解析到 ${programs.length} 个 program 条目（来自 ${filePath}）。`);
        } else {
           // ... patch logic ...
           const patches = xmlDoc.getElementsByTagName('patch');
           if (patches.length > 0) {
             // User requested NOT to show patch files in the list
             // So we do nothing here for the table
             log(`解析到 ${patches.length} 个 patch 条目（来自 ${filePath}，列表中隐藏）。`);
             
             // If this is the only file and it's a patch file, we might want to hide the table if it was empty
             // But if we have multiple files, we keep the table visible for others.
             if (paths.length === 1) {
                xmlPreview.style.display = 'none';
             }
           } else {
             if (paths.length === 1) {
                xmlPreview.style.display = 'none';
                log('未在 XML 中找到 <program> 或 <patch> 标签。');
             }
           }
        }
      } catch (e) {
        log(`解析 XML 出错 ${filePath}：${e.message}`);
      }
  }
}

document.getElementById('start-btn').addEventListener('click', async () => {
  if (!currentPort) {
    alert('请先连接设备。');
    return;
  }
 if(!devprgInput.value){
    alert('请选择必须的 devprg 文件。');
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
    alert('初始化成功！现在可以执行 XML 命令。');
  } else {
    log(`错误：${result.error}`);
    alert(`初始化失败：${result.error}`);
  }
});

document.querySelectorAll('[data-xml-mode]').forEach((button) => {
  button.addEventListener('click', (event) => {
    handleXmlOperation(event.currentTarget.dataset.xmlMode);
  });
});

async function handleReboot(mode) {
  if (!currentPort) {
    alert('请先连接设备。');
    return;
  }
  log(`尝试重启到 ${mode}...`);
  const result = await window.api.rebootDevice({ port: currentPort, mode });
  if (result.success) {
    log(`重启指令已发送（${mode}）。`);
  } else {
    log(`重启失败：${result.error}`);
  }
}

document.getElementById('reboot-btn').addEventListener('click', () => handleReboot('reboot'));
document.getElementById('reboot-recovery-btn').addEventListener('click', () => handleReboot('recovery'));
document.getElementById('reboot-fastboot-btn').addEventListener('click', () => handleReboot('fastboot'));
document.getElementById('reboot-edl-btn').addEventListener('click', () => handleReboot('edl'));

document.getElementById('read-gpt-btn').addEventListener('click', async () => {
  if (!currentPort) {
    alert('请先连接设备。');
    return;
  }
  log('正在从所有 LUN 读取分区表...');
  log('这可能需要几分钟...\n');
  
  const result = await window.api.readGPT({ port: currentPort });
  
  if (result.success) {
    log(`\n✓ 分区表读取成功！`);
    log(`✓ 已处理 ${result.lunsRead} 个 LUN`);
    log(`✓ 请查看 bin/tmp/ 目录中的提取数据\n`);
    alert(`GPT 读取完成！已处理 ${result.lunsRead} 个 LUN。\n请查看日志和 bin/tmp/ 目录中的结果。`);
  } else {
    log(`\n✗ 读取分区表出错：${result.error}\n`);
    alert(`读取分区表失败：${result.error}`);
  }
});


async function loadDefaultFiles() {
  try {
    const files = await window.api.getDefaultFiles();
    devprgInput.value = files.devprg;
    digestInput.value = files.digest;
    sigInput.value = files.sig;
  } catch (error) {
    log(`加载默认文件出错：${error.message}`);
  }
}

findPort();
loadDefaultFiles();
