# Compiling the RapidDocs Desktop Agent (.exe)

This guide provides step-by-step instructions to compile the **RapidDocs Desktop Agent** into a standalone, lightweight, native Windows executable (`.exe`).

---

## 📋 Prerequisites for Windows Compilation

Tauri compiled binaries require the standard Microsoft C++ build toolchain and the Rust compiler. Follow these three steps to set them up:

### 1. Install Microsoft C++ Build Tools
Tauri requires Visual Studio C++ build tools to link native libraries.
1. Download the **Visual Studio Installer** from [visualstudio.microsoft.com/visual-cpp-build-tools/](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. Run the installer and select the workload:
   - **Desktop development with C++**
3. On the right-hand panel, ensure the following components are checked:
   - **MSVC v143 - VS 2022 C++ x64/x86 build tools**
   - **Windows 10 SDK** (or **Windows 11 SDK**)
4. Click **Install** and restart your computer if prompted.

### 2. Install Rust
1. Download `rustup-init.exe` from [rustup.rs](https://rustup.rs/).
2. Run the installer.
3. Select option `1` (default installation).
4. Restart your terminal to refresh your system's `PATH` variables.
5. Verify the installation by running:
   ```bash
   rustc --version
   cargo --version
   ```

---

## 🛠️ Build Steps

Once the prerequisites are installed, you can compile the project:

### Step 1: Install Dependencies
Open a PowerShell terminal, navigate to the `agent` folder, and install all required Node modules:
```powershell
cd agent
npm install
```

### Step 2: Run in Development Mode (Optional)
To run the desktop application locally in hot-reload development mode:
```powershell
npm run tauri dev
```
*This will open the native webview window linked to your local code.*

### Step 3: Compile the Release Binary (.exe)
To compile the optimized, native Windows executable:
```powershell
npm run tauri build
```

---

## 📦 Output Location

Once the compile build completes successfully:
* The native `.exe` installer is saved at:
  ```
  d:\proj\agent\src-tauri\target\release\bundle\msi\agent_0.1.0_x64_en-US.msi
  ```
* The standalone `.exe` executable is saved at:
  ```
  d:\proj\agent\src-tauri\target\release\agent.exe
  ```

Copy this `agent.exe` to any Windows computer to run the RapidDocs terminal link!
