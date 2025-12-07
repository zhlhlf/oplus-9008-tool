# 9008 Tool (Electron)

This is an Electron-based tool for Qualcomm 9008 mode operations, replacing the traditional batch script.

## Prerequisites

- Node.js installed.
- The `bin` folder must contain the necessary executables (`QSaharaServer.exe`, `fh_loader.exe`, `lsusb.exe`, etc.).

## Setup

1. Open a terminal in this folder.
2. Run `npm install` to install the dependencies (Electron).

## Usage

1. Run `npm start` to launch the application.
2. Connect your device in 9008 mode.
3. The tool should automatically detect the port (or click "Refresh Port").
4. Select the required files:
   - **DevPrg File**: The programmer file (e.g., `prog_firehose_ddr.elf`).
   - **Digest File**: The digest file.
   - **Signature File**: The signature file.
5. Click **Connect & Initialize**.
   - This will run the sequence to establish communication and unlock permissions.
   - Check the "Logs" section for progress.
6. Once initialized, the "XML Operations" section will become active.
7. Select an XML file (e.g., `rawprogram0.xml` or a custom command xml) and click **Run XML Command**.

## Troubleshooting

- If the device is not detected, ensure drivers are installed and it shows up in Device Manager as "Qualcomm HS-USB QDLoader 9008".
- Check the logs for any error messages from the underlying tools.
