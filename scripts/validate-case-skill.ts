#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { parseDocument } from 'yaml'

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML mapping.`)
  }
  return value as RecordValue
}

function yaml(text: string, label: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`${label}: ${document.errors.map(({ message }) => message).join('; ')}`)
  }
  return document.toJS({ maxAliasCount: 0 })
}

function requiredString(mapping: RecordValue, key: string, label: string): string {
  const value = mapping[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`)
  }
  return value
}

async function validateSkill(argument: string): Promise<void> {
  const directory = resolve(argument)
  const folderName = basename(directory)
  const skillText = await readFile(join(directory, 'SKILL.md'), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(skillText)
  if (!match) throw new Error(`${directory}/SKILL.md must contain YAML frontmatter and a body.`)

  const frontmatter = object(yaml(match[1]!, 'SKILL.md frontmatter'), 'SKILL.md frontmatter')
  const keys = Object.keys(frontmatter).sort()
  if (keys.join(',') !== 'description,name') {
    throw new Error('SKILL.md frontmatter must contain only name and description.')
  }
  const name = requiredString(frontmatter, 'name', 'SKILL.md frontmatter')
  requiredString(frontmatter, 'description', 'SKILL.md frontmatter')
  if (!/^[a-z0-9-]+$/.test(name) || name.length > 63 || name !== folderName) {
    throw new Error(`Skill name '${name}' must match folder '${folderName}' and use lowercase hyphen-case.`)
  }
  if (match[2]!.trim().length === 0 || /\b(?:TODO|FIXME)\b/.test(match[2]!)) {
    throw new Error('SKILL.md body must be non-empty and contain no TODO/FIXME placeholders.')
  }

  const agentText = await readFile(join(directory, 'agents', 'openai.yaml'), 'utf8')
  const agent = object(yaml(agentText, 'agents/openai.yaml'), 'agents/openai.yaml')
  const interface_ = object(agent.interface, 'agents/openai.yaml interface')
  requiredString(interface_, 'display_name', 'agents/openai.yaml interface')
  const shortDescription = requiredString(
    interface_,
    'short_description',
    'agents/openai.yaml interface',
  )
  if (shortDescription.length < 25 || shortDescription.length > 64) {
    throw new Error('interface.short_description must contain 25-64 characters.')
  }
  const defaultPrompt = requiredString(interface_, 'default_prompt', 'agents/openai.yaml interface')
  if (!defaultPrompt.includes(`$${name}`)) {
    throw new Error(`interface.default_prompt must explicitly mention $${name}.`)
  }

  process.stdout.write(`PASS ${name} (${directory})\n`)
}

async function main(arguments_: readonly string[]): Promise<void> {
  if (arguments_.length === 0) {
    throw new Error('Usage: tsx scripts/validate-case-skill.ts SKILL_DIRECTORY [...]')
  }
  for (const argument of arguments_) await validateSkill(argument)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
