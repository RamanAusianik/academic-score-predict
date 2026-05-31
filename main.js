const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

app.setName('Предсказатель успеваемости студентов')

ipcMain.handle('save-xlsx-file', async (_event, data, defaultName) => {
  const win = BrowserWindow.getFocusedWindow()
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
    title: 'Сохранить объединённый Excel',
    defaultPath: defaultName || 'merged.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  fs.writeFileSync(filePath, Buffer.from(data))
  return { ok: true, filePath }
})

function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Предсказатель успеваемости студентов',
    webPreferences: {
      // Allows us to use Node.js features in the frontend if needed
      nodeIntegration: true, 
      contextIsolation: false
    }
  })

  // Load the index.html of the app.
  mainWindow.loadFile('./build/index.html')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})