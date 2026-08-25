import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function isRegularCaseSource(directory: string): Promise<boolean> {
  try {
    const stats = await lstat(join(directory, 'case.yml'))
    return stats.isFile() && !stats.isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Expands package directories or parent directories without knowing any case
 * slug or case ID. Discovery is shallow, deterministic, and ignores unrelated
 * siblings.
 */
export async function discoverCasePackageDirectories(
  inputs: readonly string[],
): Promise<string[]> {
  const packages = new Set<string>()
  for (const input of inputs) {
    const candidate = resolve(input)
    const stats = await lstat(candidate)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Case discovery input must be a real directory: ${candidate}`)
    }
    if (await isRegularCaseSource(candidate)) {
      packages.add(candidate)
      continue
    }
    const entries = (await readdir(candidate, { withFileTypes: true })).sort((left, right) =>
      compareRaw(left.name, right.name),
    )
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const child = join(candidate, entry.name)
      if (await isRegularCaseSource(child)) packages.add(child)
    }
  }
  const result = [...packages].sort(compareRaw)
  if (result.length === 0) {
    throw new Error(`No case packages were found under: ${inputs.map((input) => resolve(input)).join(', ')}`)
  }
  return result
}
