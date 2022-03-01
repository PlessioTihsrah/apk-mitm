import * as path from 'path'
import { once } from 'events'
import * as fs from './utils/fs'
import Listr = require('listr')
import chalk = require('chalk')

import { TaskOptions } from './cli'
import observeAsync from './utils/observe-async'
import applyPatches from './tasks/apply-patches'
import checkPrerequisites from './tasks/check-prerequisites'

export default function (options: TaskOptions) {
  const { apktool, uberApkSigner } = options

  const decodeDir = options.inputPath
  const tmpApkPath = path.join(options.tmpDir, 'tmp.apk')

  let fallBackToAapt = false

  return new Listr([
    {
      title: 'Checking prerequisities',
      task: () => checkPrerequisites(options),
    },
    {
      title: 'Applying patches',
      skip: () => options.skipPatches,
      task: () =>
        applyPatches(decodeDir, {
          debuggable: options.debuggable,
          certificatePath: options.certificatePath,
        }),
    },
    {
      title: 'Waiting for you to make changes',
      enabled: () => options.wait,
      task: () =>
        observeAsync(async log => {
          process.stdin.setEncoding('utf-8')
          process.stdin.setRawMode!(true)

          log('Press any key to continue.')
          await once(process.stdin, 'data')

          process.stdin.setRawMode!(false)
          process.stdin.pause()
        }),
    },
    {
      title: 'Encoding patched APK file',
      task: () =>
        new Listr([
          {
            title: 'Encoding using AAPT2',
            task: (_, task) =>
              observeAsync(async next => {
                try {
                  await apktool
                    .encode(decodeDir, tmpApkPath, true)
                    .forEach(next)
                } catch {
                  task.skip('Failed, falling back to AAPT...')
                  fallBackToAapt = true
                }
              }),
          },
          {
            title: chalk`Encoding using AAPT {dim [fallback]}`,
            skip: () => !fallBackToAapt,
            task: () => apktool.encode(decodeDir, tmpApkPath, false),
          },
        ]),
    },
    {
      title: 'Signing patched APK file',
      task: () =>
        observeAsync(async log => {
          await uberApkSigner
            .sign([tmpApkPath], { zipalign: true })
            .forEach(line => log(line))

          await fs.copyFile(tmpApkPath, options.outputPath)
        }),
    },
  ])
}
