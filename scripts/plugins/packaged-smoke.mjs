import { spawn } from 'node:child_process'
import { mkdir, cp, writeFile, mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = join(root, '.cache/plugin-packaged-smoke')
await mkdir(base, { recursive: true })
const run = await mkdtemp(join(base, 'run-'))
const profile = join(run, 'isolated-profile')
const fixture = join(run, 'plugin-fixture')
await mkdir(profile)
await cp(join(root, 'extensions/kokoro-test'), fixture, { recursive: true })
const runtime = resolve(process.argv[2] ?? join(root, 'release/plugin-support/runtime'))
const executable = join(root, 'release/win-unpacked/AI 视频工作台.exe')
const server = createServer()
await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
const port = server.address().port
await new Promise((resolveClosed) => server.close(resolveClosed))
const child = spawn(executable, [`--inspect-brk=127.0.0.1:${port}`], { cwd: run, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let socket
let sequence = 0
const pending = new Map()
const events = new Map()
const send = (method, params = {}) => new Promise((resolveResult, reject) => {
  const id = ++sequence
  pending.set(id, { resolveResult, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const nextEvent = (name) => new Promise((resolveEvent) => events.set(name, resolveEvent))
const timeout = setTimeout(() => child.kill(), 300000)
const exited = new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code)))
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let stderr = ''
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Packaged Electron exited before debugger was ready')))
    child.stderr.on('data', (data) => {
      stderr += data.toString()
      const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)
      if (match) resolveEndpoint(match[0])
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      if (message.error) task.reject(new Error(JSON.stringify(message.error)))
      else task.resolveResult(message.result)
    } else {
      const listener = events.get(message.method)
      if (listener) { events.delete(message.method); listener(message.params) }
    }
  }
  socket.onclose = () => { for (const task of pending.values()) task.reject(new Error('Debugger connection closed')); pending.clear() }
  await send('Debugger.enable')
  const paused = nextEvent('Debugger.paused')
  await send('Runtime.runIfWaitingForDebugger')
  const pause = await paused
  // 仅测试脚本通过本机 Node 调试器隔离 profile 和模拟已确认的原生对话框；产品没有测试后门。
  const expression = `(() => {
    const { app, BrowserWindow, dialog, utilityProcess } = require('electron');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const profile = ${JSON.stringify(profile)};
    let fixture = ${JSON.stringify(fixture)};
    const runtime = ${JSON.stringify(runtime)};
    const originalFork = utilityProcess.fork.bind(utilityProcess);
    const diagnostics = [];
    utilityProcess.fork = (entry, args, options) => {
      diagnostics.push({ entry });
      const child = originalFork(entry, args, { ...options, stdio: 'pipe' });
      child.stderr?.on('data', data => diagnostics.push({ stderr: data.toString() }));
      child.on('exit', code => diagnostics.push({ exit: code }));
      return child;
    };
    app.setPath('userData', profile);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    globalThis.__pluginSmokeExit = () => app.quit();
    globalThis.__pluginSmokeResult = app.whenReady().then(async () => {
      assert.equal(app.isPackaged, true);
      assert.equal(app.getPath('userData'), profile);
      let window;
      for (let i = 0; i < 300; i++) {
        window = BrowserWindow.getAllWindows()[0];
        if (window && !window.webContents.isLoading() && window.webContents.getURL().startsWith('file:')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.ok(window);
      const call = async (method, ...args) => {
        const result = await window.webContents.executeJavaScript('window.workbench[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + ')');
        if (!result.ok) throw new Error(result.error);
        return result.value;
      };
      const initial = await call('listExtensions');
      assert.equal(initial.length, 0);
      const installed = await call('installExtension');
      assert.equal(installed[0].id, 'workbench.kokoro-test');
      assert.equal(installed[0].enabled, false);
      await fs.rename(fixture, fixture + '-source-moved');
      fixture += '-source-moved';
      const id = 'workbench.kokoro-test';
      const settings = { 'runtime-directory': runtime, 'voice-id': 45 };
      await call('saveExtensionSettings', { id, values: settings });
      await call('setExtensionEnabled', id, true);
      const voices = await call('listExtensionVoices', id, id + '.cpu');
      assert.equal(voices.length, 8);
      assert.ok(voices.every(v => v.source === 'preset'));
      assert.equal(await call('runExtensionCommand', id, id + '.generate'), true);
      const outputs = path.join(profile, 'extension-data', id);
      const names = (await fs.readdir(outputs)).filter(n => n.endsWith('.wav'));
      assert.equal(names.length, 1);
      const audio = await fs.readFile(path.join(outputs, names[0]));
      assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
      assert.equal(audio.readUInt32LE(24), 24000);
      assert.ok(audio.length > 48000);
      assert.ok(audio.subarray(44).some(x => x !== 0));
      await call('setExtensionEnabled', id, false);
      await assert.rejects(call('listExtensionVoices', id, id + '.cpu'));
      await call('removeExtension', id);
      assert.equal((await call('listExtensions')).length, 0);
      assert.deepEqual(await fs.readFile(path.join(outputs, names[0])), audio);
      await call('installExtension');
      await call('saveExtensionSettings', { id, values: { ...settings, 'voice-id': 50 } });
      await call('setExtensionEnabled', id, true);
      assert.equal((await call('listExtensionVoices', id, id + '.cpu')).length, 8);
      assert.equal(await call('runExtensionCommand', id, id + '.generate'), true);
      const allNames = (await fs.readdir(outputs)).filter(n => n.endsWith('.wav'));
      assert.equal(allNames.length, 2);
      const second = await fs.readFile(path.join(outputs, allNames.find(n => n !== names[0])));
      assert.equal(second.readUInt32LE(24), 24000);
      assert.ok(second.subarray(44).some(x => x !== 0));
      const uuid = require('node:crypto').randomUUID;
      const scope = { projectId: uuid(), draftId: uuid() };
      const workspace = await call('loadWorkspace');
      await call('saveWorkspace', { expectedRevision: workspace.revision, workspace: { ...workspace, projects: [{
        id: scope.projectId, name: '隔离生产验收', sample: false, episodes: [], videoDrafts: [{
          id: scope.draftId, title: '插件台词生产', description: '', prompt: '测试输入快照', promptDocument: '',
          duration: 8, aspectRatio: '16:9', resolution: '720P', instance: 'plus', instanceMode: 'auto'
        }]
      }] } });
      const registered = await call('productionCapabilities');
      assert.ok(registered.some(item => item.extensionId === id && item.available));
      const line = { id: uuid(), character: '测试角色', text: '你好，这是草稿中的独立台词生产。', delivery: '', speed: 1,
        extensionId: id, providerId: id + '.cpu', voiceId: '45', language: 'zh-CN', startMs: 0 };
      const plan = await call('saveProduction', { ...scope, revision: 0, enabled: true, lines: [line] });
      const awaitTake = async takeId => {
        for (let i = 0; i < 1200; i++) {
          const production = await call('loadProduction', scope);
          const take = production.takes.find(item => item.id === takeId);
          if (take && !['queued', 'running', 'cancelling'].includes(take.status)) {
            assert.equal(take.status, 'succeeded', take.error);
            return take;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Production task timed out');
      };
      const firstTake = await awaitTake((await call('generateDialogue', { ...scope, revision: plan.revision, lineId: line.id })).id);
      const candidateAudio = await fs.readFile(path.join(profile, 'assets', firstTake.assetId + '.wav'));
      assert.equal(candidateAudio.toString('ascii', 0, 4), 'RIFF');
      const mediaDuration = await window.webContents.executeJavaScript('new Promise((resolve, reject) => {' +
        'const audio = new Audio(' + JSON.stringify('workbench-asset://library/' + firstTake.assetId) + ');' +
        'const timer = setTimeout(() => { audio.src = ""; reject(new Error("Audio protocol timeout")); }, 10000);' +
        'audio.onloadedmetadata = () => { clearTimeout(timer); const duration = audio.duration; audio.src = ""; resolve(duration); };' +
        'audio.onerror = () => { clearTimeout(timer); reject(new Error("Audio protocol unavailable")); };' +
        'audio.preload = "metadata"; audio.load(); })');
      assert.ok(Math.abs(mediaDuration * 1000 - firstTake.durationMs) < 200);
      await call('adoptDialogue', { ...scope, revision: plan.revision, takeId: firstTake.id });
      const nextTake = await awaitTake((await call('generateDialogue', { ...scope, revision: plan.revision, lineId: line.id })).id);
      await call('adoptDialogue', { ...scope, revision: plan.revision, takeId: nextTake.id });
      const production = await call('loadProduction', scope);
      assert.equal(production.takes.length, 2);
      assert.equal(production.takes.find(item => item.id === firstTake.id).adopted, false);
      assert.equal(production.takes.find(item => item.id === nextTake.id).adopted, true);
      assert.equal((await call('listAssets', { projectId: scope.projectId, kind: 'audio' })).length, 2);
      assert.ok((await call('listDialogueTasks')).some(item => item.id === firstTake.id));
      await assert.rejects(call('deleteAsset', firstTake.assetId));
      await call('setExtensionEnabled', id, false);
      return { packaged: app.isPackaged, resourcesPath: process.resourcesPath, profile, runtime,
        sourceMovedAfterInstall: true, voices: voices.length, disabledCallRejected: true,
        uninstallPreservedAudio: true, reinstallPassed: true,
        productionCandidates: production.takes.length, productionAdoptionPassed: true, productionAssetsProtected: true,
        productionAudioProtocolDuration: mediaDuration,
        outputs: allNames.map(n => path.join(outputs, n)), sampleRate: 24000,
        durationsSeconds: [(audio.length - 44) / 48000, (second.length - 44) / 48000] };
    }).catch(error => ({ failed: true, message: error.message, stack: error.stack, diagnostics }));
    return 'armed';
  })()`
  const armed = await send('Debugger.evaluateOnCallFrame', { callFrameId: pause.callFrames[0].callFrameId, expression, returnByValue: true })
  if (armed.exceptionDetails) throw new Error(JSON.stringify(armed.exceptionDetails))
  await send('Debugger.resume')
  const result = await send('Runtime.evaluate', { expression: 'globalThis.__pluginSmokeResult', awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  const report = result.result.value
  await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ reportPath: join(run, 'report.json'), ...report }, null, 2))
  await send('Runtime.evaluate', { expression: 'globalThis.__pluginSmokeExit()' }).catch(() => undefined)
  socket.close()
  await exited
  if (report.failed) process.exitCode = 1
} finally {
  clearTimeout(timeout)
  socket?.close()
  child.kill()
}
