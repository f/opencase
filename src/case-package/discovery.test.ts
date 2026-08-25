import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverCasePackageDirectories } from './discovery'

const roots: string[] = []

async function packageDirectory(parent: string, name: string): Promise<string> {
  const directory = join(parent, name)
  await mkdir(directory)
  await writeFile(join(directory, 'case.yml'), 'schema: fixture\n', 'utf8')
  return directory
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('case package discovery', () => {
  it('expands parent directories in raw deterministic order and ignores unrelated siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-discovery-'))
    roots.push(root)
    const later = await packageDirectory(root, 'z-package')
    const earlier = await packageDirectory(root, 'a-package')
    await mkdir(join(root, 'notes'))

    await expect(discoverCasePackageDirectories([root])).resolves.toEqual([earlier, later])
  })

  it('accepts a package directly and de-duplicates repeated inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-discovery-'))
    roots.push(root)
    const packageRoot = await packageDirectory(root, 'fixture-package')

    await expect(
      discoverCasePackageDirectories([packageRoot, root, packageRoot]),
    ).resolves.toEqual([packageRoot])
  })

  it('rejects a symlink as a discovery root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'case-discovery-'))
    roots.push(root)
    const packageRoot = await packageDirectory(root, 'fixture-package')
    const link = join(root, 'package-link')
    await symlink(packageRoot, link, 'dir')

    await expect(discoverCasePackageDirectories([link])).rejects.toThrow(/real directory/)
  })
})
