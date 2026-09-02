import { WebSocket } from 'ws'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface DevToolsTarget {
	type: string
	url: string
	webSocketDebuggerUrl?: string
}

interface Pending {
	resolve: (value: unknown) => void
	reject: (reason: Error) => void
	timer: NodeJS.Timeout
}

/** Fallback timeout for a single CDP round-trip, so a wedged renderer cannot hang the job. */
const DEFAULT_CALL_TIMEOUT = 120_000

/**
 * A minimal Chrome DevTools Protocol client, connected straight to the
 * Blockbench renderer's page target. All it does is run code in the renderer and
 * hand back the (JSON) result - the same contract jestbench's bridge provides,
 * without pulling in puppeteer.
 */
export class RendererBridge {
	private nextId = 1
	private readonly pending = new Map<number, Pending>()

	private constructor(private readonly ws: WebSocket) {
		ws.on('message', data => {
			let message: { id?: number; error?: { message: string }; result?: unknown }
			try {
				message = JSON.parse(data.toString())
			} catch {
				return
			}
			if (typeof message.id !== 'number') return
			const entry = this.pending.get(message.id)
			if (!entry) return
			this.pending.delete(message.id)
			clearTimeout(entry.timer)
			if (message.error) entry.reject(new Error(message.error.message))
			else entry.resolve(message.result)
		})
		ws.on('close', () => this.rejectAll(new Error('DevTools connection closed')))
		// Without a listener a stray 'error' event throws; 'close' follows and cleans up.
		ws.on('error', () => {})
	}

	private rejectAll(reason: Error): void {
		for (const { reject, timer } of this.pending.values()) {
			clearTimeout(timer)
			reject(reason)
		}
		this.pending.clear()
	}

	/** Poll the DevTools HTTP endpoint until the Blockbench page target is up, then attach. */
	static async attach(port: number, timeoutMs = 60_000): Promise<RendererBridge> {
		const deadline = Date.now() + timeoutMs
		let target: DevToolsTarget | undefined

		while (Date.now() < deadline) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/json/list`)
				if (response.ok) {
					const targets = (await response.json()) as DevToolsTarget[]
					target =
						targets.find(
							t =>
								t.type === 'page' &&
								(t.url.includes('app.asar') || t.url.endsWith('index.html'))
						) ?? targets.find(t => t.type === 'page')
					if (target?.webSocketDebuggerUrl) break
				}
			} catch {
				/* endpoint not up yet */
			}
			await delay(250)
		}

		if (!target?.webSocketDebuggerUrl) {
			throw new Error(`No Blockbench page target on the DevTools port after ${timeoutMs}ms`)
		}

		const ws = new WebSocket(target.webSocketDebuggerUrl, {
			// Blueprints (and their embedded textures) can be large; don't cap the frame size.
			maxPayload: 1024 * 1024 * 1024,
		})
		await new Promise<void>((resolve, reject) => {
			ws.once('open', () => resolve())
			ws.once('error', reject)
		})
		return new RendererBridge(ws)
	}

	private call(
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number
	): Promise<unknown> {
		const id = this.nextId++
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`))
			}, timeoutMs)
			this.pending.set(id, { resolve, reject, timer })
			try {
				this.ws.send(JSON.stringify({ id, method, params }))
			} catch (e) {
				clearTimeout(timer)
				this.pending.delete(id)
				reject(e as Error)
			}
		})
	}

	/**
	 * Run `fn` in the Blockbench renderer and return its JSON-serialisable result.
	 * `fn` may be async. Arguments are JSON-encoded, so closures do not cross the
	 * boundary - pass everything `fn` needs as an argument.
	 */
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	async evaluate<T = unknown>(
		fn: string | Function,
		args: unknown[] = [],
		timeoutMs = DEFAULT_CALL_TIMEOUT
	): Promise<T> {
		const expression =
			typeof fn === 'string'
				? fn
				: `(${fn.toString()}).apply(null, ${JSON.stringify(
						args.map(arg => (arg === undefined ? null : arg))
					)})`

		const result = (await this.call(
			'Runtime.evaluate',
			{
				expression,
				awaitPromise: true,
				returnByValue: true,
				allowUnsafeEvalBlockingCall: true,
			},
			timeoutMs
		)) as {
			result?: { value?: T }
			exceptionDetails?: { exception?: { description?: string }; text?: string }
		}

		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ??
					result.exceptionDetails.text ??
					'Renderer evaluation failed'
			)
		}
		return result.result?.value as T
	}

	/** Wait until `expression` is truthy in the renderer, or throw after `timeoutMs`. */
	async waitFor(expression: string, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			try {
				if (await this.evaluate<boolean>(expression, [], 10_000)) return
			} catch {
				/* renderer not ready to evaluate yet */
			}
			await delay(500)
		}
		throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${expression}`)
	}

	close(): void {
		try {
			this.ws.close()
		} catch {
			/* already closed */
		}
	}
}
