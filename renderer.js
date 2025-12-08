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
    portDisplay.textContent = 'Not found';
    // log('Device disconnected');
  }
});

async function findPort() {
  // Manual check still useful for initial load
  portDisplay.textContent = 'Searching...';
  const port = await window.api.findPort();
  if (port) {
    currentPort = port;
    portDisplay.textContent = port;
    log(`Found device on ${port}`);
  } else {
    currentPort = null;
    portDisplay.textContent = 'Not found';
  }
}

document.getElementById('refresh-port').addEventListener('click', findPort);

document.getElementById('clear-logs-btn').addEventListener('click', () => {
  logsDiv.innerHTML = '';
  log('Logs cleared');
});

let selectedXmlFiles = [];

const xmlOperationConfigs = {
  run: {
    mode: 'run',
    logPrefix: 'Running XML command with files: ',
    successLog: 'XML command executed successfully.',
    errorPrefix: 'Error running XML'
  },
  read: {
    mode: 'read',
    logPrefix: 'Reading data with files: ',
    successLog: 'Read operation completed successfully.',
    errorPrefix: 'Error during read operation'
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
    alert('Please connect a device first.');
    return;
  }

  const normalizedMode = (mode || 'run').toLowerCase();
  const operation = xmlOperationConfigs[normalizedMode] || xmlOperationConfigs.run;
  const filesToRun = resolveXmlFiles();

  if (filesToRun.length === 0) {
    alert('Please select an XML file.');
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
    log(`${operation.errorPrefix}: ${result.error}`);
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
      log(`Reading XML: ${filePath}`);
      const result = await window.api.readFileContent(filePath);
      
      if (!result.success) {
        log(`Error reading file: ${result.error}`);
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
          log(`Parsed ${programs.length} program entries from ${filePath}.`);
        } else {
           // ... patch logic ...
           const patches = xmlDoc.getElementsByTagName('patch');
           if (patches.length > 0) {
             // User requested NOT to show patch files in the list
             // So we do nothing here for the table
             log(`Parsed ${patches.length} patch entries from ${filePath} (hidden from list).`);
             
             // If this is the only file and it's a patch file, we might want to hide the table if it was empty
             // But if we have multiple files, we keep the table visible for others.
             if (paths.length === 1) {
                xmlPreview.style.display = 'none';
             }
           } else {
             if (paths.length === 1) {
                xmlPreview.style.display = 'none';
                log('No <program> or <patch> tags found in XML.');
             }
           }
        }
      } catch (e) {
        log(`Error parsing XML ${filePath}: ${e.message}`);
      }
  }
}

document.getElementById('start-btn').addEventListener('click', async () => {
  if (!currentPort) {
    alert('Please connect a device first.');
    return;
  }
 if(!devprgInput.value){
    alert('Please select devprgInput required files.');
    return;
 }

  log('Starting initialization process...');
  const result = await window.api.startProcess({
    port: currentPort,
    devprg: devprgInput.value,
    digest: digestInput.value,
    sig: sigInput.value
  });

  if (result.success) {
    log('Initialization successful!');
    // xmlSection.style.opacity = '1'; // No longer needed
    // xmlSection.style.pointerEvents = 'auto'; // No longer needed
    alert('Initialization successful! You can now run XML commands.');
  } else {
    log(`Error: ${result.error}`);
    alert(`Initialization failed: ${result.error}`);
  }
});

document.querySelectorAll('[data-xml-mode]').forEach((button) => {
  button.addEventListener('click', (event) => {
    handleXmlOperation(event.currentTarget.dataset.xmlMode);
  });
});

async function handleReboot(mode) {
  if (!currentPort) {
    alert('Please connect a device first.');
    return;
  }
  log(`Attempting to reboot to ${mode}...`);
  const result = await window.api.rebootDevice({ port: currentPort, mode });
  if (result.success) {
    log(`Reboot command sent (${mode}).`);
  } else {
    log(`Error rebooting: ${result.error}`);
  }
}

document.getElementById('reboot-btn').addEventListener('click', () => handleReboot('reboot'));
document.getElementById('reboot-recovery-btn').addEventListener('click', () => handleReboot('recovery'));
document.getElementById('reboot-fastboot-btn').addEventListener('click', () => handleReboot('fastboot'));
document.getElementById('reboot-edl-btn').addEventListener('click', () => handleReboot('edl'));

document.getElementById('read-gpt-btn').addEventListener('click', async () => {
  if (!currentPort) {
    alert('Please connect a device first.');
    return;
  }
  log('Reading partition table from all LUNs...');
  log('This may take a few minutes...\n');
  
  const result = await window.api.readGPT({ port: currentPort });
  
  if (result.success) {
    log(`\n✓ Partition table read successfully!`);
    log(`✓ Processed ${result.lunsRead} LUN(s)`);
    log(`✓ Check bin/tmp/ directory for extracted partition data\n`);
    alert(`GPT read complete! ${result.lunsRead} LUN(s) processed.\nCheck the logs and bin/tmp/ directory for results.`);
  } else {
    log(`\n✗ Error reading partition table: ${result.error}\n`);
    alert(`Failed to read partition table: ${result.error}`);
  }
});


async function loadDefaultFiles() {
  try {
    const files = await window.api.getDefaultFiles();
    devprgInput.value = files.devprg;
    digestInput.value = files.digest;
    sigInput.value = files.sig;
    log('Default files loaded from bin/res');
  } catch (error) {
    log(`Error loading default files: ${error.message}`);
  }
}

findPort();
loadDefaultFiles();
