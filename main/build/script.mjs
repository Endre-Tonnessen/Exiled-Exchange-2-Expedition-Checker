import child_process from 'child_process'
import electron from 'electron'
import esbuild from 'esbuild'
import fs from 'fs'

const isDev = !process.argv.includes('--prod')

const electronRunner = (() => {
  let handle = null
  return {
    restart () {
      console.info('Restarting Electron process.')

      if (handle) handle.kill()
      handle = child_process.spawn(electron, ['.'], {
        stdio: 'inherit'
      })
    }
  }
})()

const visionBuild = await esbuild.build({
  entryPoints: ['src/vision/link-worker.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/vision.js'
})

// Not JS - esbuild's bundler doesn't touch it, but WindowsOcr.ts locates it via
// __dirname at runtime (same convention link-main.ts uses for vision.js above), so
// it needs to sit next to the compiled output rather than just live in src/.
fs.copyFileSync('src/vision/windows-ocr-recognize.ps1', 'dist/windows-ocr-recognize.ps1')

const mainContext = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: !isDev,
  platform: 'node',
  external: ['electron', 'uiohook-napi', 'electron-overlay-window'],
  outfile: 'dist/main.js',
  define: {
    'process.env.STATIC': (isDev) ? '"../build/icons"' : '"."',
    'process.env.VITE_DEV_SERVER_URL': (isDev) ? '"http://localhost:5173"' : 'null'
  },
  plugins: (isDev) ? [{
    name: 'electron-runner',
    setup (build) {
      build.onEnd((result) => {
        if (!result.errors.length) electronRunner.restart()
      })
    }
  }] : []
})

if (isDev) {
  await mainContext.watch()
} else {
  await mainContext.rebuild()
  mainContext.dispose()
}
