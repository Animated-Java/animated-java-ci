import { type ChildProcess } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { Envbench, getPortablePath } from 'envbench'
import type { NamedBlockbenchVersion, ResolvedBlockbenchVersion } from 'envbench'
import * as log from './log'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Fixed envbench environment name - one isolated Blockbench install for the action. */
const ENVIRONMENT = 'animated-java-ci'

export interface RunningBlockbench {
	debugPort: number
	userDataDir: string
	child: ChildProcess
	readLog: () => string
	kill: () => Promise<void>
}

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.unref()
		server.on('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			server.close(() => resolve(port))
		})
	})
}

function numericSemver(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
	}
	return 0
}

/**
 * Ensure the isolated Blockbench environment exists (downloading Blockbench on
 * first use) and return the path to its portable executable.
 */
async function ensurePortable(eb: Envbench, blockbenchVersion: string): Promise<string> {
	if ((await eb.environmentExists(ENVIRONMENT)) !== 'env') {
		log.info(`Provisioning Blockbench (${blockbenchVersion}) via envbench...`)
		let lastPercent = -1
		await eb.createEnvironment(
			ENVIRONMENT,
			{ blockbenchVersion: blockbenchVersion as NamedBlockbenchVersion, force: true },
			{
				onDownloadStart: version => log.info(`Downloading Blockbench ${version}`),
				onProgress: ({ percent }) => {
					const step = Math.floor(percent * 10) * 10
					if (step > lastPercent) {
						lastPercent = step
						log.info(`  ${step}%`)
					}
				},
			}
		)
	}

	const env = await eb.getEnvironment(ENVIRONMENT)
	let version: ResolvedBlockbenchVersion | '' = ''
	try {
		version = await eb.resolveVersion(env.blockbench_version)
	} catch {
		version = [...(await eb.listInstalledVersions())].sort(numericSemver).at(-1) ?? ''
	}
	if (!version) {
		throw new Error(
			'Could not determine which Blockbench version to launch. Check network access ' +
				'or pin `blockbench-version` to an exact x.y.z with a warm ~/.envbench cache.'
		)
	}

	const portable = getPortablePath(eb.portablesCache, version)
	if (!existsSync(portable)) {
		throw new Error(`Blockbench ${version} portable is missing at ${portable}`)
	}
	return portable
}

/**
 * Launch Blockbench with the Chrome DevTools Protocol enabled and wait until its
 * endpoint answers. The caller is expected to already be running under
 * `xvfb-run` (the action wrapper does this) so no window appears.
 */
export async function launchBlockbench(blockbenchVersion: string): Promise<RunningBlockbench> {
	const eb = new Envbench()
	await eb.ensureStorageFolder()
	const userDataDir = join(eb.storageDir, ENVIRONMENT)

	// Clear a stale Chromium singleton lock a previously hard-killed run may have left.
	await killByUserData(userDataDir)
	for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
		try {
			rmSync(join(userDataDir, lock), { force: true })
		} catch {
			/* nothing to clear */
		}
	}

	await ensurePortable(eb, blockbenchVersion)
	grantFsPermission(userDataDir, 'animated_java')
	const debugPort = await getFreePort()

	const child = await eb.launch(ENVIRONMENT, {
		extraArgs: [
			`--remote-debugging-port=${debugPort}`,
			'--remote-allow-origins=*',
			// CI sandboxes usually disallow the AppImage's sandbox re-exec.
			'--no-sandbox',
			'--disable-dev-shm-usage',
		],
	})

	let logBuffer = ''
	const append = (chunk: Buffer) => {
		logBuffer = (logBuffer + chunk.toString()).slice(-64 * 1024)
	}
	child.stdout?.on('data', append)
	child.stderr?.on('data', append)

	let exited = false
	child.on('exit', () => {
		exited = true
	})

	const running: RunningBlockbench = {
		debugPort,
		userDataDir,
		child,
		readLog: () => logBuffer,
		kill: async () => {
			try {
				child.kill('SIGTERM')
			} catch {
				/* already gone */
			}
			await killByUserData(userDataDir)
		},
	}

	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(
				`Blockbench exited before its DevTools endpoint came up.\n${tail(logBuffer)}`
			)
		}
		try {
			const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
			if (response.ok) return running
		} catch {
			/* not up yet */
		}
		await delay(250)
	}

	await running.kill()
	throw new Error(`Timed out waiting for Blockbench to start.\n${tail(logBuffer)}`)
}

/**
 * Kill any Blockbench process bound to this environment's userData dir. The
 * AppImage (with `APPIMAGE_EXTRACT_AND_RUN`) re-execs itself, so the inner
 * process often escapes the launcher's process group - match it by command line.
 */
async function killByUserData(userDataDir: string): Promise<void> {
	const targets = () => {
		try {
			const out = spawnSync('pgrep', ['-f', '--', userDataDir], { encoding: 'utf-8' })
			return (out.stdout ?? '')
				.split('\n')
				.map(s => Number(s.trim()))
				.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid)
		} catch {
			return []
		}
	}

	const signal = (pid: number, sig: NodeJS.Signals) => {
		try {
			process.kill(pid, sig)
		} catch {
			/* already gone */
		}
	}

	if (targets().length === 0) return
	for (const pid of targets()) signal(pid, 'SIGTERM')

	const deadline = Date.now() + 4000
	while (Date.now() < deadline) {
		await delay(150)
		if (targets().length === 0) return
	}
	for (const pid of targets()) signal(pid, 'SIGKILL')
	await delay(300)
}

function tail(text: string, lines = 25): string {
	return text.split('\n').slice(-lines).join('\n')
}

/**
 * Pre-grant a plugin filesystem access.
 *
 * The first time a plugin calls `requireNativeModule('fs')` Blockbench pops a
 * *synchronous, main-process* permission dialog ("Plugin Permission"). It blocks
 * the renderer entirely and there is no one to click it, so the export hangs.
 * Blockbench reads this file once at startup, so writing it before launch is the
 * only way to skip the prompt. Shape:
 *
 *   { "<pluginId>": { "allowed": { "fs": true } } }
 */
function grantFsPermission(userDataDir: string, pluginId: string): void {
	const file = join(userDataDir, 'plugin_permissions.json')
	let permissions: Record<string, { allowed: Record<string, unknown> }> = {}
	try {
		const existing = JSON.parse(readFileSync(file, 'utf-8'))
		if (existing && typeof existing === 'object') permissions = existing
	} catch {
		/* no file yet, or unreadable - start fresh */
	}

	const entry = permissions[pluginId] ?? { allowed: {} }
	entry.allowed = { ...entry.allowed, fs: true }
	permissions[pluginId] = entry

	writeFileSync(file, JSON.stringify(permissions, null, '\t'))
}
