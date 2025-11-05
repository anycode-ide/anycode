import { app, BrowserWindow } from 'electron';

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 700,
    })
    win.loadURL('http://localhost:5173')
}

app.whenReady().then(() => {
    createWindow()
})