import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as log from './log'

const REPO = 'Animated-Java/animated-java'
const ASSET_NAME = 'animated_java.js'

interface GitHubRelease {
	tag_name: string
	assets: Array<{ name: string; browser_download_url: string }>
}

/**
 * Produce a local `animated_java.js` for the action to load into Blockbench.
 * Prioritizes the `pluginPath`; otherwise the `animated_java.js` asset is downloaded from the matching GitHub release.
 * Returns the file path and a human-readable description of what was resolved.
 */
export async function resolvePlugin(options: {
	version: string
	pluginPath: string | undefined
	githubToken: string | undefined
}): Promise<{ path: string; source: string }> {
	const dir = mkdtempSync(join(tmpdir(), 'animated-java-ci-plugin-'))
	const dest = join(dir, ASSET_NAME)

	if (options.pluginPath) {
		if (!existsSync(options.pluginPath)) {
			throw new Error(`plugin-path does not exist: ${options.pluginPath}`)
		}
		copyFileSync(options.pluginPath, dest)
		return { path: dest, source: `local file ${options.pluginPath}` }
	}

	const release = await fetchRelease(options.version, options.githubToken)
	const asset = release.assets.find(a => a.name === ASSET_NAME)
	if (!asset) {
		throw new Error(
			`Release ${release.tag_name} has no ${ASSET_NAME} asset. ` +
				`Available: ${release.assets.map(a => a.name).join(', ') || '(none)'}`
		)
	}

	log.info(`Downloading ${ASSET_NAME} from Animated Java ${release.tag_name}`)
	const response = await fetch(asset.browser_download_url, {
		headers: authHeaders(options.githubToken),
		redirect: 'follow',
	})
	if (!response.ok) {
		throw new Error(`Failed to download ${asset.browser_download_url}: ${response.status}`)
	}
	writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
	return { path: dest, source: `Animated Java ${release.tag_name}` }
}

async function fetchRelease(version: string, token: string | undefined): Promise<GitHubRelease> {
	const base = `https://api.github.com/repos/${REPO}/releases`
	const url = version === 'latest' ? `${base}/latest` : `${base}/tags/${normalizeTag(version)}`

	const response = await fetch(url, {
		headers: { Accept: 'application/vnd.github+json', ...authHeaders(token) },
	})
	if (response.status === 404) {
		throw new Error(
			version === 'latest'
				? `No "latest" release found for ${REPO}`
				: `No Animated Java release tagged "${normalizeTag(version)}"`
		)
	}
	if (!response.ok) {
		const hint = response.status === 403 ? ' (GitHub API rate limit - pass github-token)' : ''
		throw new Error(`GitHub API ${response.status} for ${url}${hint}`)
	}
	return (await response.json()) as GitHubRelease
}

function normalizeTag(version: string): string {
	return /^v/i.test(version) ? version : `v${version}`
}

function authHeaders(token: string | undefined): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {}
}
