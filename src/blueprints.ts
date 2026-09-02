import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const EXTENSION = '.ajblueprint'
const SKIP_DIRS = new Set(['node_modules', '.git'])

/** Every `.ajblueprint` file under `root`, recursively, sorted for stable output. */
export function findBlueprints(root: string): string[] {
	const found: string[] = []

	const walk = (dir: string) => {
		let entries
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(full)
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith(EXTENSION)) {
				found.push(full)
			} else if (entry.isSymbolicLink()) {
				try {
					if (statSync(full).isFile() && entry.name.toLowerCase().endsWith(EXTENSION)) {
						found.push(full)
					}
				} catch {
					/* dangling link */
				}
			}
		}
	}

	walk(root)
	return found.sort()
}
