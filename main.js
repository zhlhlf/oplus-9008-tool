const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execFile } = require('child_process');

let mainWindow;

const BIN_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin')
  : path.join(__dirname, 'bin');
const fhLoaderPath = path.join(BIN_DIR, 'fh_loader.exe');
const extractGptPath = path.join(BIN_DIR, 'extract_gpt.exe');
const lsusbPath = path.join(BIN_DIR, 'lsusb.exe');
const CMD_XML = path.join(BIN_DIR, 'cmd.xml');
const TMP_DIR = path.join(BIN_DIR, 'tmp');
const TMP_BIN = path.join(TMP_DIR, 'tmp.bin');


function createWindow() {
  const iconPath = path.join(BIN_DIR, 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: iconPath,
    autoHideMenuBar: true, // Hide the menu bar
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  startPortPolling();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (logFlushTimer) clearTimeout(logFlushTimer);
  flushLogs();
  if (logStream) logStream.end();
});

// Helper to run commands
function runCommand(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    // Remove surrounding quotes from command if present
    let executable = command;
    if (executable.startsWith('"') && executable.endsWith('"')) {
      executable = executable.slice(1, -1);
    }

    log(`\n> Executing: ${executable} ${args.join(' ')}\n`);

    const parser = options.progress ? createProgressParser(options.progress) : null;

    // Handle .exe files using spawn
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const text = data.toString();
        log(text);
        if (parser) parser.feed(text);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => log(data.toString()));
    }

    child.on('close', (code) => {
      if (parser) parser.flush();
      if (code === 0) {
        resolve('Success');
      } else {
        const msg = `Process exited with code ${code}`;
        log(`\n[ERROR] ${msg}\n`);
        reject(new Error(msg));
      }
    });

    child.on('error', (error) => {
      log(`\n[ERROR] Process failed: ${error.message}\n`);
      reject(error);
    });

  });
}

let lastRuleProgressMessage = null;

function emitRuleProgress(message) {
  if (message === lastRuleProgressMessage) return;
  lastRuleProgressMessage = message;
  logProgress(`  ${message}\n`);
}

let progressTotal = 0;
let progressDone = 0;
let progressLabel = '';
let progressSpeed = '';

function sendProgress(label) {
  if (typeof label === 'string') progressLabel = label;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const percent = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  mainWindow.webContents.send('progress', {
    percent,
    done: progressDone,
    total: progressTotal,
    label: progressLabel,
    speed: progressSpeed
  });
}

function startProgress(total, label) {
  progressTotal = total > 0 ? total : 0;
  progressDone = 0;
  progressSpeed = '';
  sendProgress(label);
}

function advanceProgress(label) {
  if (progressTotal > 0 && progressDone < progressTotal) progressDone++;
  sendProgress(label);
}

function finishProgress(label) {
  if (progressTotal > 0) progressDone = progressTotal;
  sendProgress(label);
}

function normalizeSpeed(raw) {
  const match = String(raw).trim().match(/([\d.]+)\s*([KMG]?Bps)/i);
  if (!match || parseFloat(match[1]) === 0) return '';
  const unit = match[2].toUpperCase().replace('BPS', 'B/s');
  return `${match[1]} ${unit}`;
}

function setProgressSpeed(raw) {
  const speed = normalizeSpeed(raw);
  if (!speed || speed === progressSpeed) return;
  progressSpeed = speed;
  sendProgress();
}

// Parse fh_loader output and emit per-partition progress into the progress channel
function createProgressParser({ mode = 'write', labels, rules = [], onProgress, onSpeed } = {}) {
  const labelMap = labels || new Map();
  const verb = mode === 'read' ? '读取' : '写入';
  let buffer = '';
  let activeFile = null;

  const resolveLabel = (file) => {
    const base = path.basename(file);
    return labelMap.get(base) || labelMap.get(base.toLowerCase()) || base.replace(/\.[^.]+$/, '');
  };

  const finishActive = () => {
    if (!activeFile) return;
    const label = resolveLabel(activeFile);
    logProgress(`\n✔ ${label} 分区${verb}完毕\n`);
    activeFile = null;
    if (typeof onProgress === 'function') onProgress(label);
  };

  const startFile = (file) => {
    if (activeFile && path.basename(activeFile) === path.basename(file)) return;
    finishActive();
    activeFile = file;
    logProgress(`\n${verb} ${resolveLabel(file)} 分区中...\n`);
  };

  const processLine = (line) => {
    if (typeof onSpeed === 'function') {
      const speedMatch = line.match(/Overall to target[^(]*\(([^)]*)\)/i);
      if (speedMatch) onSpeed(speedMatch[1]);
    }

    for (const rule of rules) {
      const ruleMatch = line.match(rule.re);
      if (!ruleMatch) continue;
      const message = rule.build ? rule.build(ruleMatch) : rule.re.source;
      emitRuleProgress(message);
      return;
    }

    let match = line.match(/In handleRead\(['"](.+?)['"]\)/);
    if (match) {
      startFile(match[1]);
      return;
    }
    match = line.match(/In handleProgram\(['"](.+?)['"]\)/);
    if (match) {
      startFile(match[1]);
      return;
    }
    match = line.match(/\{<program>\s*FILE:\s*'(.+?)'/);
    if (match) {
      const label = resolveLabel(match[1]);
      if (activeFile && path.basename(activeFile) === path.basename(match[1])) {
        activeFile = null;
      }
      logProgress(`\n✔ ${label} 分区写入完毕\n`);
      if (typeof onProgress === 'function') onProgress(label);
    }
  };

  return {
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) processLine(line);
    },
    flush() {
      if (buffer) {
        processLine(buffer);
        buffer = '';
      }
      finishActive();
    }
  };
}

// Rules for the boot / initialization layer (Sahara handshake, VIP, signature)
const INIT_PROGRESS_RULES = [
  { re: /SAHARA_WAIT_HELLO/, build: () => '等待设备进入 Sahara 模式...' },
  { re: /SAHARA_HELLO_RESPONSE/, build: () => 'Sahara 握手成功' },
  { re: /SAHARA_READ_DATA/, build: () => '正在下发引导固件...' },
  { re: /SAHARA_END_IMAGE_TX/, build: () => '引导固件下发完成' },
  { re: /VIP is enabled/i, build: () => 'VIP 校验已启用' },
  { re: /svip_check_permission ok/i, build: () => '签名校验通过' }
];

// Build a basename(filename) -> label map from the XML files being flashed
function buildLabelMap(xmlPaths) {
  const map = new Map();
  const seen = new Set();
  for (const xmlPath of xmlPaths) {
    let content;
    try {
      content = fs.readFileSync(xmlPath, 'utf-8');
    } catch (error) {
      continue;
    }
    const regex = /<program\b[^>]*>/gi;
    let match;
    while ((match = regex.exec(content))) {
      const tag = match[0];
      const labelMatch = tag.match(/\blabel="([^"]*)"/i);
      const fileMatch = tag.match(/\bfilename="([^"]*)"/i);
      if (labelMatch && fileMatch) {
        const base = path.basename(fileMatch[1]);
        map.set(base, labelMatch[1]);
        map.set(base.toLowerCase(), labelMatch[1]);
        seen.add(base);
      }
    }
  }
  return { map, total: seen.size };
}

// Helper to find port
function findPortLogic() {
  return new Promise((resolve) => {
    // Use wmic instead of lsusb.exe to avoid window flashing and dependency issues
    // wmic path Win32_PnPEntity where "Caption like '%Qualcomm HS-USB QDLoader 9008%'" get Caption
    const command = `${lsusbPath} ^| find "Qualcomm HS-USB QDLoader 9008 (COM"`

    // Keep windowsHide: true for port polling to avoid annoying flashing every 2 seconds
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        // If wmic fails, resolve null
        resolve(null);
        return;
      }
      const match = stdout.match(/\((COM\d+)\)/);
      if (match && match[1]) {
        resolve(match[1]);
      } else {
        resolve(null);
      }
    });
  });
}

let portPollInterval;
let lastPort = null;

function startPortPolling() {
  if (portPollInterval) clearInterval(portPollInterval);
  portPollInterval = setInterval(async () => {
    const port = await findPortLogic();
    if (port !== lastPort) {
      lastPort = port;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('port-update', port);
      }
    }
  }, 2000);
}

ipcMain.handle('select-file', async (event, { multiple = false, directory = false } = {}) => {
  const properties = [];
  if (directory) {
    properties.push('openDirectory');
  } else {
    properties.push('openFile');
    if (multiple) {
      properties.push('multiSelections');
    }
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties
  });
  if (result.canceled) {
    return multiple ? [] : null;
  }
  return multiple ? result.filePaths : result.filePaths[0];
});

const XML_FLASH_PREFIXES = ['rawprogram', 'patch', 'provision'];

function isFlashXml(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.xml') && XML_FLASH_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function compareFlashXml(a, b) {
  const pa = XML_FLASH_PREFIXES.findIndex((prefix) => a.toLowerCase().startsWith(prefix));
  const pb = XML_FLASH_PREFIXES.findIndex((prefix) => b.toLowerCase().startsWith(prefix));
  if (pa !== pb) return pa - pb;
  const na = parseInt((a.match(/(\d+)/) || [])[1] || '0', 10);
  const nb = parseInt((b.match(/(\d+)/) || [])[1] || '0', 10);
  return na - nb || a.localeCompare(b);
}

function collectXmlFiles(paths) {
  const files = [];
  for (const p of paths) {
    if (!p) continue;
    let stat;
    try {
      stat = fs.statSync(p);
    } catch (error) {
      continue;
    }
    if (stat.isDirectory()) {
      let entries = [];
      try {
        entries = fs.readdirSync(p);
      } catch (error) {
        continue;
      }
      const matched = entries.filter((name) => {
        try {
          return fs.statSync(path.join(p, name)).isFile() && isFlashXml(name);
        } catch (error) {
          return false;
        }
      });
      matched.sort(compareFlashXml);
      for (const name of matched) {
        files.push(path.join(p, name));
      }
    } else if (/\.xml$/i.test(p)) {
      files.push(p);
    }
  }
  return files;
}

ipcMain.handle('resolve-xml-selection', async (event, paths) => {
  const list = Array.isArray(paths) ? paths : [paths];
  return collectXmlFiles(list);
});

ipcMain.handle('find-port', async () => {
  return await findPortLogic();
});

ipcMain.handle('start-process', async (event, { port, devprg, digest, sig }) => {
  try {
    logStep('开始初始化流程');
    lastRuleProgressMessage = null;
    logProgress('\n===== 引导初始化 =====\n');

    let initTotal = 1;
    if (devprg) initTotal++;
    if (digest) initTotal++;
    if (sig) initTotal++;
    startProgress(initTotal, '初始化');

    // 1. Send device programmer (if provided)
    if (devprg) {
      logStep('发送设备程序（Device Programmer）');
      logProgress('\n▶ 发送设备程序（DevPrg），等待设备握手...\n');
      const qSaharaPath = path.join(BIN_DIR, 'QSaharaServer.exe');
      // Remove manual quotes around paths, spawn handles escaping
      await runCommand(`"${qSaharaPath}"`, ['-p', `\\\\.\\${port}`, '-s', `13:${devprg}`], BIN_DIR, {
        progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed }
      });
      advanceProgress('设备程序');

    }
    logStep('继续初始化流程');

    // 2. Send digest (if provided)
    if (digest) {
      logStep('发送 Digest 并校验');
      logProgress('\n▶ 发送 Digest 并校验...\n');

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        `--signeddigests=${digest}`,
        '--testvipimpact', '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR, { progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed } });


      // 3. Send verify command (grouped with digest)
      const verifyXmlContent = '<?xml version="1.0"?><data><verify value="ping" EnableVip="1"/></data>';
      fs.writeFileSync(CMD_XML, verifyXmlContent);

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        '--sendxml=cmd.xml',
        '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR, { progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed } });
      advanceProgress('Digest');

    }

    // 4. Send sig (if provided)
    if (sig) {
      logStep('发送 Signature 并执行 Sha256Init');
      logProgress('\n▶ 发送 Signature 并校验签名...\n');

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        `--signeddigests=${sig}`,
        '--testvipimpact', '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR, { progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed } });


      // 5. Send sha256init command (grouped with sig)
      const sha256XmlContent = '<?xml version="1.0"?><data><sha256init Verbose="1"/></data>';
      fs.writeFileSync(CMD_XML, sha256XmlContent);

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        '--sendxml=cmd.xml',
        '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR, { progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed } });
      advanceProgress('Signature');

    }

    // 6. Configure (Always run at the end of init sequence)
    logProgress('\n▶ 配置存储（UFS）...\n');
    const ConfigureContent = '<?xml version="1.0" ?><data><configure MemoryName="ufs" Verbose="0" AlwaysValidate="0" MaxDigestTableSizeInBytes="8192" MaxPayloadSizeToTargetInBytes="1048576" ZlpAwareHost="1" SkipStorageInit="0" /></data>';

    fs.writeFileSync(CMD_XML, ConfigureContent);

    await runCommand(`"${fhLoaderPath}"`, [
      `--port=\\\\.\\${port}`,
      '--configure=cmd.xml',
      '--memoryname=ufs',
      '--noprompt',
      '--mainoutputdir=.\\'
    ], BIN_DIR, { progress: { rules: INIT_PROGRESS_RULES, onSpeed: setProgressSpeed } });
    advanceProgress('配置');

    finishProgress('初始化完成');
    logStep('初始化完成');
    logProgress('\n✔ 初始化完成，可以执行 XML 操作\n');
    return { success: true };
  } catch (error) {
    log(`\n[错误] ${error.message}\n`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('exit-app', () => {
  app.quit();
});

ipcMain.handle('execute-xml', async (event, { port, xmlPath, searchPath, mode = 'run' }) => {
  try {
    if (!port) {
      throw new Error('Port is required for XML execution');
    }
    const xmlPaths = (Array.isArray(xmlPath) ? xmlPath : [xmlPath]).filter(Boolean);
    if (xmlPaths.length === 0) {
      throw new Error('XML path is required for XML execution');
    }

    const defaultSearchPath = path.dirname(xmlPaths[0]);
    const finalSearchPath = searchPath || defaultSearchPath;

    const xmlFilesArg = xmlPaths.join(',');
    const fileNames = xmlPaths.map((p) => path.basename(p)).join(', ');

    const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : 'run';
    const resolvedMode = normalizedMode === 'read' ? 'read' : 'run';
    const operations = {
      run: {
        logLabel: `执行 XML 写入：${fileNames}`,
        args: [
          `--port=\\\\.\\${port}`,
          '--memoryname=UFS',
          `--search_path=${finalSearchPath}`,
          `--sendxml=${xmlFilesArg}`,
          '--special_rw_mode=oplus_gptbackup',
          '--noprompt'
        ]
      },
      read: {
        logLabel: `按 XML 读取：${fileNames}`,
        args: [
          `--port=\\\\.\\${port}`,
          `--sendxml=${xmlFilesArg}`,
          '--convertprogram2read',
          '--memoryname=ufs',
          `--mainoutputdir=${TMP_DIR}`,
          '--skip_configure',
          '--showpercentagecomplete',
          '--special_rw_mode=oplus_gptbackup',
          '--noprompt'
        ]
      }
    };

    const operation = operations[resolvedMode];

    const { map: labelMap, total: partitionTotal } = buildLabelMap(xmlPaths);
    logStep(operation.logLabel);
    startProgress(partitionTotal, resolvedMode === 'read' ? '读取' : '写入');
    await runCommand(`"${fhLoaderPath}"`, operation.args, BIN_DIR, {
      progress: {
        mode: resolvedMode,
        labels: labelMap,
        onProgress: (label) => advanceProgress(label),
        onSpeed: setProgressSpeed
      }
    });
    finishProgress(resolvedMode === 'read' ? '读取完成' : '写入完成');
    dialog.showMessageBox(mainWindow, { type: 'info', title: '成功', message: '操作已成功完成' });
    if (resolvedMode === 'read')
      shell.openPath(TMP_DIR);
    return { success: true };
  } catch (error) {
    log(`\n[错误] ${error.message}\n`);
    dialog.showMessageBox(mainWindow, { type: 'error', title: '错误', message: error.message });
    return { success: false, error: error.message };
  }
});

const rebootContexts = new Map();
// Contexts will be provided later
const rebootContext = '<?xml version="1.0" ?><data><power DelayInSeconds="0" value="reset" /></data>';

rebootContexts.set('reboot', { cmd: rebootContext });
rebootContexts.set('bootloader', { txt: 'bootonce-bootloader', cmd: rebootContext });
rebootContexts.set('recovery', { txt: 'boot-recovery', cmd: rebootContext });
rebootContexts.set('fastboot', { txt: 'boot-fastboot', cmd: rebootContext });
rebootContexts.set('edl', { cmd: '<?xml version="1.0" ?><data><power value="reset_to_edl" /></data>' });

async function prepareMiscFlash(port, txtValue) {
  if (!port) {
    throw new Error('更新 misc 分区需要端口信息');
  }

  if (typeof txtValue !== 'string' || txtValue.trim().length === 0) {
    throw new Error('misc 分区的 TXT 负载为空');
  }

  if (!fs.existsSync(extractGptPath)) {
    throw new Error('在 bin 目录中未找到 extract_gpt.exe');
  }

  const payloadBuffer = Buffer.from(txtValue, 'utf-8');

  logStep('准备 misc 分区负载');

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  log(`\n写入 TXT 负载到 ${TMP_BIN}\n`);
  fs.writeFileSync(TMP_BIN, payloadBuffer);

  const lunsRead = await readGptForRange(port, 1);
  if (lunsRead <= 0) {
    throw new Error('读取 LUN 0 的 GPT 数据失败');
  }

  const rawprogramPath = path.join(TMP_DIR, 'rawprogram0.xml');
  if (!fs.existsSync(rawprogramPath)) {
    throw new Error('未找到 rawprogram0.xml；无法获取 misc 分区元数据');
  }

  const rawprogramContent = fs.readFileSync(rawprogramPath, 'utf-8');
  const miscMatch = rawprogramContent.match(/<program\b[^>]*\blabel="misc"[^>]*>/i);

  if (!miscMatch) {
    throw new Error('在 GPT 数据中未找到 misc 分区条目');
  }

  const miscTag = miscMatch[0];
  const getAttr = (name) => {
    const regex = new RegExp(`${name}="([^"]+)"`, 'i');
    const match = miscTag.match(regex);
    return match ? match[1] : null;
  };

  const sectorSize = parseInt(getAttr('SECTOR_SIZE_IN_BYTES') || '512', 10);
  const startSector = getAttr('start_sector');
  const physicalPartition = getAttr('physical_partition_number') || '0';
  const num_partition_sectors = getAttr('num_partition_sectors') || '0';

  if (!sectorSize || !startSector) {
    throw new Error('misc 分区元数据无效');
  }

  const miscXmlPath = path.join(TMP_DIR, 'rawprogram_misc.xml');
  const miscXmlContent = [
    '<?xml version="1.0" ?>',
    '<data>',
    `  <program filename="${path.basename(TMP_BIN)}" label="misc" SECTOR_SIZE_IN_BYTES="${sectorSize}" file_sector_offset="0" num_partition_sectors="${num_partition_sectors}" physical_partition_number="${physicalPartition}" start_sector="${startSector}" />`,
    '</data>',
    ''
  ].join('\n');
  fs.writeFileSync(miscXmlPath, miscXmlContent);

  logStep('写入 misc 分区更新');
  await runCommand(`"${fhLoaderPath}"`, [
    `--port=\\\\.\\${port}`,
    `--search_path=${TMP_DIR}`,
    `--sendxml=${path.basename(miscXmlPath)}`,
    '--noprompt',
    '--skip_configure',
    `--mainoutputdir=${TMP_DIR}`,
    '--showpercentagecomplete'
  ], BIN_DIR);
}

ipcMain.handle('reboot-device', async (event, { port, mode }) => {
  try {
    if (!port) {
      throw new Error('重启操作需要端口信息');
    }

    const context = rebootContexts.get(mode);
    if (!context) {
      throw new Error(`不支持的重启模式：${mode}`);
    }

    const hasTxt = context.txt || null;

    if (hasTxt) {
      await prepareMiscFlash(port, hasTxt);
    }

    logStep(`正在重启到：${mode}`);

    fs.writeFileSync(CMD_XML, context.cmd);

    await runCommand(`"${fhLoaderPath}"`, [
      `--port=\\\\.\\${port}`,
      `--sendxml=${CMD_XML}`,
      '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
    ], TMP_DIR);

    return { success: true };
  } catch (error) {
    log(`\n[错误] ${error.message}\n`);
    return { success: false, error: error.message };
  }
});

function isFileBlank(filePath) {
  if (!fs.existsSync(filePath)) return true;

  const stats = fs.statSync(filePath);
  if (stats.size < 512) return true;

  const buffer = Buffer.alloc(512);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 512, 0);
  fs.closeSync(fd);

  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) return false;
  }
  return true;
}

async function readGptForRange(port, maxLun, options = {}) {
  let validLuns = 0;

  for (let lun = 0; lun < maxLun; lun++) {
    log(`\n--- 正在读取 LUN ${lun} ---\n`);

    const tmpBinPath = path.join(TMP_DIR, `gpt_main${lun}.bin`);
    const readGptXml = `
<?xml version="1.0" ?>
<data>
    <program SECTOR_SIZE_IN_BYTES="4096" filename="gpt_main${lun}.bin" physical_partition_number="${lun}" label="PrimaryGPT" start_sector="0" num_partition_sectors="6"/>
</data>
`;
    fs.writeFileSync(CMD_XML, readGptXml);

    try {
      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        `--mainoutputdir=tmp`,
        '--sendxml=cmd.xml',
        '--convertprogram2read',
        '--skip_configure',
        '--showpercentagecomplete',
        '--noprompt',
      ], BIN_DIR);

      if (options.progress) advanceProgress(`LUN ${lun}`);

      if (isFileBlank(tmpBinPath)) {
        log(`LUN ${lun}：文件为空或无效，跳过。\n`);
        continue;
      }

      log(`LUN ${lun}：GPT 数据读取成功（${fs.statSync(tmpBinPath).size} 字节）\n`);
      log(`正在提取 LUN ${lun} 的分区表...\n`);

      await runCommand(`"${extractGptPath}"`, [
        `gpt_main${lun}.bin`,
        `${lun}`
      ], TMP_DIR);

      validLuns++;
    } catch (error) {
      log(`\n[警告] 读取 LUN ${lun} 失败：${error.message}\n`);
      if (lun === maxLun - 1) {
        log(`LUN ${lun} 读取失败，如果设备分区较少这是正常情况。\n`);
      }
      break;
    }
  }

  return validLuns;
}

ipcMain.handle('read-gpt', async (event, { port }) => {
  try {
    logStep('读取分区表（GPT）');

    cleanAndCreate(TMP_DIR);
    // 检查 extract_gpt.exe 是否存在
    if (!fs.existsSync(extractGptPath)) {
      throw new Error('在 bin 目录中未找到 extract_gpt.exe');
    }

    const maxLun = 6;
    startProgress(maxLun, '读取分区表');
    const validLuns = await readGptForRange(port, maxLun, { progress: true });
    finishProgress('读取分区表完成');

    if (validLuns === 0) {
      return;
    }

    logStep(`GPT 读取完成 - 已处理 ${validLuns} 个 LUN`);
    log(`\n分区表数据已保存到：${TMP_DIR}\n`);
    log('请在 tmp 目录中查看提取的分区信息。\n');

    // Open the directory in file explorer
    shell.openPath(TMP_DIR);

    return { success: true, lunsRead: validLuns };
  } catch (error) {
    log(`\n[错误] ${error.message}\n`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file-content', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-default-files', async () => {
  cleanAndCreate(TMP_DIR);

  const RES_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'res')
    : path.join(__dirname, 'bin', 'res');

  const getPath = (name) => {
    const p = path.join(RES_DIR, name);
    return fs.existsSync(p) ? p : '';
  };

  const saved = readFileSelection();
  const resolvePath = (key, name) => {
    const savedPath = typeof saved[key] === 'string' ? saved[key] : '';
    return savedPath && fs.existsSync(savedPath) ? savedPath : getPath(name);
  };

  return {
    devprg: resolvePath('devprg', 'devprg'),
    digest: resolvePath('digest', 'digest'),
    sig: resolvePath('sig', 'sig')
  };
});

const FILE_SELECTION_FILE = () => path.join(app.getPath('userData'), 'file-selection.json');

function readFileSelection() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE_SELECTION_FILE(), 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    return {};
  }
}

function writeFileSelection(patch = {}) {
  const current = readFileSelection();
  const next = {
    devprg: typeof patch.devprg === 'string' ? patch.devprg : (current.devprg || ''),
    digest: typeof patch.digest === 'string' ? patch.digest : (current.digest || ''),
    sig: typeof patch.sig === 'string' ? patch.sig : (current.sig || ''),
    xml: Array.isArray(patch.xml) ? patch.xml.filter((p) => typeof p === 'string' && p) : (Array.isArray(current.xml) ? current.xml : [])
  };
  fs.writeFileSync(FILE_SELECTION_FILE(), JSON.stringify(next, null, 2), 'utf-8');
}

ipcMain.handle('save-file-selection', async (event, selection = {}) => {
  try {
    writeFileSelection(selection);
    return { success: true };
  } catch (error) {
    log(`保存文件选择失败：${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-xml-selection', async (event, paths = []) => {
  try {
    writeFileSelection({ xml: Array.isArray(paths) ? paths : [paths] });
    return { success: true };
  } catch (error) {
    log(`保存 XML 选择失败：${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-saved-xml', async () => {
  const saved = readFileSelection();
  return collectXmlFiles(Array.isArray(saved.xml) ? saved.xml : []);
});

const LOG_FILE = path.join(__dirname, 'operation.log');
const LOG_FLUSH_INTERVAL = 100;

let logStream = null;
let pendingCoreLog = '';
let pendingProgressLog = '';
let logFlushTimer = null;

function getLogStream() {
  if (!logStream) {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    logStream.on('error', (err) => console.error('写入日志文件失败：', err));
  }
  return logStream;
}

function scheduleLogFlush() {
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL);
  }
}

function flushLogs() {
  logFlushTimer = null;
  if (pendingCoreLog) {
    getLogStream().write(pendingCoreLog);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log', pendingCoreLog);
    }
    pendingCoreLog = '';
  }
  if (pendingProgressLog) {
    getLogStream().write(pendingProgressLog);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-progress', pendingProgressLog);
    }
    pendingProgressLog = '';
  }
}

function log(message) {
  pendingCoreLog += message;
  scheduleLogFlush();
}

function logProgress(message) {
  pendingProgressLog += message;
  scheduleLogFlush();
}

function logStep(stepName) {
  const timestamp = new Date().toLocaleString();
  const msg = `\n[${timestamp}] === ${stepName} ===\n`;
  log(msg);
}

// Helper to save temp XML
ipcMain.handle('save-temp-xml', async (event, content) => {
  const tempPath = path.join(TMP_DIR, `rawprogram_generated_zhlhlf.xml`);
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    log(`已保存生成的 XML 文件到：${tempPath}`);
    return tempPath;
  } catch (error) {
    const msg = `保存临时 XML 失败：${error.message}`;
    log(`[ERROR] ${msg}`);
    throw new Error(msg);
  }
});

function cleanAndCreate(dir) {
  if (fs.existsSync(dir)) {
    const stat = fs.statSync(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    if (stat.isFile()) return;
  }
  fs.mkdirSync(dir, { recursive: true });
}
