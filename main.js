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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
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

// Helper to run commands
function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    // Remove surrounding quotes from command if present
    let executable = command;
    if (executable.startsWith('"') && executable.endsWith('"')) {
      executable = executable.slice(1, -1);
    }

    log(`\n> Executing: ${executable} ${args.join(' ')}\n`);

    // Handle .exe files using spawn
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => log(data.toString()));
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => log(data.toString()));
    }

    child.on('close', (code) => {
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

ipcMain.handle('select-file', async (event, { multiple = false } = {}) => {
  const properties = ['openFile'];
  if (multiple) {
    properties.push('multiSelections');
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties
  });
  return multiple ? result.filePaths : result.filePaths[0];
});

ipcMain.handle('find-port', async () => {
  return await findPortLogic();
});

ipcMain.handle('start-process', async (event, { port, devprg, digest, sig }) => {
  try {
    logStep('Starting Initialization Process');

    // 1. Send device programmer (if provided)
    if (devprg) {
      logStep('Sending Device Programmer');
      const qSaharaPath = path.join(BIN_DIR, 'QSaharaServer.exe');
      // Remove manual quotes around paths, spawn handles escaping
      await runCommand(`"${qSaharaPath}"`, ['-p', `\\\\.\\${port}`, '-s', `13:${devprg}`], BIN_DIR);

    }
    logStep('Starting Initialization Process');

    // 2. Send digest (if provided)
    if (digest) {
      logStep('Sending Digest & Verify');

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        `--signeddigests=${digest}`,
        '--testvipimpact', '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR);


      // 3. Send verify command (grouped with digest)
      const verifyXmlContent = '<?xml version="1.0"?><data><verify value="ping" EnableVip="1"/></data>';
      fs.writeFileSync(CMD_XML, verifyXmlContent);

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        '--sendxml=cmd.xml',
        '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR);

    }

    // 4. Send sig (if provided)
    if (sig) {
      logStep('Sending Signature & Sha256Init');

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        `--signeddigests=${sig}`,
        '--testvipimpact', '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR);


      // 5. Send sha256init command (grouped with sig)
      const sha256XmlContent = '<?xml version="1.0"?><data><sha256init Verbose="1"/></data>';
      fs.writeFileSync(CMD_XML, sha256XmlContent);

      await runCommand(`"${fhLoaderPath}"`, [
        `--port=\\\\.\\${port}`,
        '--sendxml=cmd.xml',
        '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
      ], BIN_DIR);

    }

    // 6. Configure (Always run at the end of init sequence)
    const ConfigureContent = '<?xml version="1.0" ?><data><configure MemoryName="ufs" Verbose="0" AlwaysValidate="0" MaxDigestTableSizeInBytes="8192" MaxPayloadSizeToTargetInBytes="1048576" ZlpAwareHost="1" SkipStorageInit="0" /></data>';

    fs.writeFileSync(CMD_XML, ConfigureContent);

    await runCommand(`"${fhLoaderPath}"`, [
      `--port=\\\\.\\${port}`,
      '--configure=cmd.xml',
      '--memoryname=ufs',
      '--noprompt', '--mainoutputdir=.\\'
    ], BIN_DIR);

    logStep('Initialization Complete');
    return { success: true };
  } catch (error) {
    log(`\n[ERROR] ${error.message}\n`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('execute-xml', async (event, { port, xmlPath, mode = 'run' }) => {
  try {
    if (!port) {
      throw new Error('Port is required for XML execution');
    }

    const xmlPaths = (Array.isArray(xmlPath) ? xmlPath : [xmlPath]).filter(Boolean);
    if (xmlPaths.length === 0) {
      throw new Error('XML path is required for XML execution');
    }

    const searchPath = path.dirname(xmlPaths[0]);
    const xmlFilesArg = xmlPaths.join(',');
    const fileNames = xmlPaths.map((p) => path.basename(p)).join(', ');

    const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : 'run';
    const resolvedMode = normalizedMode === 'read' ? 'read' : 'run';

    const operations = {
      run: {
        logLabel: `Running XML: ${fileNames}`,
        args: [
          `--port=\\\\.\\${port}`,
          '--memoryname=UFS',
          `--search_path=${searchPath}`,
          `--sendxml=${xmlFilesArg}`,
          '--noprompt'
        ]
      },
      read: { 
        logLabel: `Reading XML: ${fileNames}`,
        args: [
          `--port=\\\\.\\${port}`,
          `--sendxml=${xmlFilesArg}`,
          '--convertprogram2read',
          '--memoryname=ufs',
          `--mainoutputdir=${searchPath}`,
          '--skip_configure',
          '--showpercentagecomplete',
          '--special_rw_mode=oplus_gptbackup',
          '--noprompt'
        ]
      }
    };

    const operation = operations[resolvedMode];

    logStep(operation.logLabel);

    await runCommand(`"${fhLoaderPath}"`, operation.args, BIN_DIR);
    return { success: true };
  } catch (error) {
    log(`\n[ERROR] ${error.message}\n`);
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
    throw new Error('Port is required to update misc partition');
  }

  if (typeof txtValue !== 'string' || txtValue.trim().length === 0) {
    throw new Error('TXT payload for misc partition is empty');
  }

  if (!fs.existsSync(extractGptPath)) {
    throw new Error('extract_gpt.exe not found in bin directory');
  }

  const payloadBuffer = Buffer.from(txtValue, 'utf-8');

  logStep('Preparing misc partition payload');

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  log(`\nWriting TXT payload to ${TMP_BIN}\n`);
  fs.writeFileSync(TMP_BIN, payloadBuffer);

  const lunsRead = await readGptForRange(port, 1);
  if (lunsRead <= 0) {
    throw new Error('Failed to acquire GPT data for LUN 0');
  }

  const rawprogramPath = path.join(TMP_DIR, 'rawprogram0.xml');
  if (!fs.existsSync(rawprogramPath)) {
    throw new Error('rawprogram0.xml not found; misc partition metadata is unavailable');
  }

  const rawprogramContent = fs.readFileSync(rawprogramPath, 'utf-8');
  const miscMatch = rawprogramContent.match(/<program\b[^>]*\blabel="misc"[^>]*>/i);

  if (!miscMatch) {
    throw new Error('misc partition entry not located in GPT data');
  }

  const miscTag = miscMatch[0];
  const getAttr = (name) => {
    const regex = new RegExp(`${name}="([^"]+)"`, 'i');
    const match = miscTag.match(regex);
    return match ? match[1] : null;
  };

  const sectorSize = parseInt(getAttr('SECTOR_SIZE_IN_BYTES') || '512', 10);
  const totalSectors = parseInt(getAttr('num_partition_sectors') || '0', 10);
  const startSector = getAttr('start_sector');
  const physicalPartition = getAttr('physical_partition_number') || '0';
  const num_partition_sectors = getAttr('num_partition_sectors') || '0';

  if (!sectorSize || !totalSectors || !startSector) {
    throw new Error('Invalid misc partition metadata');
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
  console.log(miscXmlContent)

  logStep('Flashing misc partition update');
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
      throw new Error('Port is required for reboot operation');
    }

    const context = rebootContexts.get(mode);
    if (!context) {
      throw new Error(`Unsupported reboot mode: ${mode}`);
    }

    const hasTxt = context.txt || null;

    if (hasTxt) {
      await prepareMiscFlash(port, hasTxt);
    }

    logStep(`Rebooting device to: ${mode}`);

    fs.writeFileSync(CMD_XML, context.cmd);

    await runCommand(`"${fhLoaderPath}"`, [
      `--port=\\\\.\\${port}`,
      `--sendxml=${CMD_XML}`,
      '--noprompt', '--skip_configure', '--mainoutputdir=.\\'
    ], TMP_DIR);

    return { success: true };
  } catch (error) {
    log(`\n[ERROR] ${error.message}\n`);
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

async function readGptForRange(port, maxLun) {
  let validLuns = 0;

  for (let lun = 0; lun < maxLun; lun++) {
    log(`\n--- Reading LUN ${lun} ---\n`);

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

      if (isFileBlank(tmpBinPath)) {
        log(`LUN ${lun}: File is blank or invalid, skipping.\n`);
        continue;
      }

      log(`LUN ${lun}: GPT data read successfully (${fs.statSync(tmpBinPath).size} bytes)\n`);
      log(`Extracting partition table for LUN ${lun}...\n`);

      await runCommand(`"${extractGptPath}"`, [
        `gpt_main${lun}.bin`,
        `${lun}`
      ], TMP_DIR);

      validLuns++;
    } catch (error) {
      log(`\n[WARNING] Failed to read LUN ${lun}: ${error.message}\n`);
      if (lun === maxLun - 1) {
        log(`LUN ${lun} failed, this is expected if device has fewer partitions.\n`);
      }
      break;
    }
  }

  return validLuns;
}

ipcMain.handle('read-gpt', async (event, { port }) => {
  try {
    logStep('Reading Partition Table (GPT)');

    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Check if extract_gpt.exe exists
    if (!fs.existsSync(extractGptPath)) {
      throw new Error('extract_gpt.exe not found in bin directory');
    }

    const maxLun = 6;
    const validLuns = await readGptForRange(port, maxLun);

    if (validLuns === 0) {
      return;
    }

    logStep(`GPT Reading Complete - ${validLuns} LUN(s) processed`);
    log(`\nPartition table data saved to: ${TMP_DIR}\n`);
    log('Check the tmp directory for extracted partition information.\n');

    // Open the directory in file explorer
    shell.openPath(TMP_DIR);

    return { success: true, lunsRead: validLuns };
  } catch (error) {
    log(`\n[ERROR] ${error.message}\n`);
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
  const RES_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'res')
    : path.join(__dirname, 'bin', 'res');

  const getPath = (name) => {
    const p = path.join(RES_DIR, name);
    return fs.existsSync(p) ? p : '';
  };

  return {
    devprg: getPath('devprg'),
    digest: getPath('digest'),
    sig: getPath('sig')
  };
});

const LOG_FILE = path.join(__dirname, 'operation.log');

function logToFile(message) {
  try {
    fs.appendFileSync(LOG_FILE, message);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

function logToUi(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', message);
  }
}

function log(message) {
  logToFile(message);
  logToUi(message);
}

function logStep(stepName) {
  const timestamp = new Date().toLocaleString();
  const msg = `\n[${timestamp}] === ${stepName} ===\n`;
  log(msg);
}
