import { appendFileSync } from 'node:fs'

/** Workflow-command helpers. No dependency on `@actions/core` - the surface we need is tiny. */

export function info(message: string): void {
	process.stdout.write(message + '\n')
}

export function warning(message: string): void {
	process.stdout.write(`::warning::${oneLine(message)}\n`)
}

export function error(message: string): void {
	process.stdout.write(`::error::${oneLine(message)}\n`)
}

export function group(name: string): void {
	process.stdout.write(`::group::${oneLine(name)}\n`)
}

export function endGroup(): void {
	process.stdout.write('::endgroup::\n')
}

export function setOutput(name: string, value: string): void {
	const file = process.env.GITHUB_OUTPUT
	if (!file) {
		info(`(output) ${name}=${value}`)
		return
	}
	const delimiter = `ghadelimiter_${Math.random().toString(36).slice(2)}`
	appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}

export function appendSummary(markdown: string): void {
	const file = process.env.GITHUB_STEP_SUMMARY
	if (!file) return
	appendFileSync(file, markdown + '\n')
}

function oneLine(message: string): string {
	return message.replace(/\r?\n/g, ' ')
}
