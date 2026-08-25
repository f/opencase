import { coreCapability } from './core'
import { validateAssertionCardinality } from './assertions'
import { cloneFrozen, compareCodeUnits, deepFreeze } from './freeze'
import { validateRules } from './rules'
import { validateSchedulePlan } from './schedules'
import {
  KERNEL_CAPABILITY,
  capabilityKey,
  type AssertionDraft,
  type CapabilityDefinition,
  type CapabilityRef,
  type CapabilityRegistry,
  type CaseKernelIR,
  type CommandDecider,
  type KernelDependencies,
  type KernelRuntime,
  type KernelState,
} from './types'

export function createCapabilityRegistry(
  capabilities: readonly CapabilityDefinition[] = [],
): CapabilityRegistry {
  const definitions: Record<string, CapabilityDefinition> = {}
  for (const capability of [coreCapability, ...capabilities]) {
    if (!capability.id || !capability.version || !capability.digest) {
      throw new Error('Capability id, version and digest are required')
    }
    const key = capabilityKey(capability)
    if (definitions[key]) throw new Error(`Duplicate capability ${key}`)
    definitions[key] = {
      id: capability.id,
      version: capability.version,
      digest: capability.digest,
      commands: { ...capability.commands },
      ...(capability.reducers ? { reducers: { ...capability.reducers } } : {}),
    }
  }
  return deepFreeze({ definitions }) as CapabilityRegistry
}

export function resolveCapability(
  registry: CapabilityRegistry,
  ref: CapabilityRef,
): CapabilityDefinition {
  const capability = registry.definitions[capabilityKey(ref)]
  if (!capability) throw new Error(`Missing capability ${capabilityKey(ref)}`)
  if (capability.digest !== ref.digest) {
    throw new Error(
      `Capability digest mismatch for ${capabilityKey(ref)}: expected ${ref.digest}, registry has ${capability.digest}`,
    )
  }
  return capability
}

function validateCaseIR(caseIR: CaseKernelIR, registry: CapabilityRegistry): void {
  if (!caseIR.id || !caseIR.version || !caseIR.digest || !caseIR.schemaVersion) {
    throw new Error('Case IR requires id, version, digest and schemaVersion')
  }
  const locks = [KERNEL_CAPABILITY, ...caseIR.capabilities]
  const lockKeys = locks.map(capabilityKey)
  if (new Set(lockKeys).size !== lockKeys.length) throw new Error('Case IR has duplicate capability locks')
  for (const lock of locks) resolveCapability(registry, lock)

  const uniqueDefinitions = <T extends { readonly id: string }>(
    label: string,
    definitions: readonly T[],
  ): Map<string, T> => {
    const result = new Map<string, T>()
    for (const definition of definitions) {
      if (!definition.id) throw new Error(`${label} id is required`)
      if (result.has(definition.id)) throw new Error(`Duplicate ${label} ${definition.id}`)
      result.set(definition.id, definition)
    }
    return result
  }
  const types = uniqueDefinitions('type', caseIR.types ?? [])
  const entities = uniqueDefinitions('entity', caseIR.entities ?? [])
  const relations = uniqueDefinitions('relation', caseIR.relations ?? [])
  uniqueDefinitions('context', caseIR.contexts ?? [])
  for (const definition of types.values()) {
    if (definition.parentId && !types.has(definition.parentId)) {
      throw new Error(`Type ${definition.id} extends unknown type ${definition.parentId}`)
    }
  }
  for (const entity of entities.values()) {
    if (!types.has(entity.typeId)) {
      throw new Error(`Entity ${entity.id} uses unknown type ${entity.typeId}`)
    }
  }
  for (const relation of relations.values()) {
    if (relation.cardinality !== 'one_per_context' && relation.cardinality !== 'many_per_context') {
      throw new Error(`Relation ${relation.id} has invalid cardinality`)
    }
  }

  const commandOwners = new Map<string, string>()
  for (const lock of locks) {
    const capability = resolveCapability(registry, lock)
    for (const type of Object.keys(capability.commands)) {
      const owner = commandOwners.get(type)
      if (owner) throw new Error(`Command ${type} is declared by both ${owner} and ${capabilityKey(lock)}`)
      commandOwners.set(type, capabilityKey(lock))
    }
  }

  const assertionIds = new Set<string>()
  const initial = caseIR.initial?.assertions
  const validated = { contexts: {} as Record<string, readonly AssertionDraft[]> }
  for (const [contextId, list] of Object.entries(initial?.contexts ?? {}).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    if (!contextId) throw new Error('Assertion context id is required')
    for (const assertion of [...list].sort((left, right) => compareCodeUnits(left.id, right.id))) {
      if (assertionIds.has(assertion.id)) throw new Error(`Duplicate initial assertion ${assertion.id}`)
      assertionIds.add(assertion.id)
      validateAssertionCardinality(caseIR, validated, contextId, assertion)
      validated.contexts[contextId] = [...(validated.contexts[contextId] ?? []), assertion]
    }
  }

  const scheduleIds = new Set<string>()
  for (const schedule of caseIR.initial?.schedules ?? []) {
    validateSchedulePlan(schedule)
    if (scheduleIds.has(schedule.id)) throw new Error(`Duplicate initial schedule ${schedule.id}`)
    scheduleIds.add(schedule.id)
  }
  validateRules(caseIR)
}

export function createKernelRuntime(
  caseIR: CaseKernelIR,
  registry: CapabilityRegistry,
  dependencies: KernelDependencies,
): KernelRuntime {
  const frozenIR = cloneFrozen(caseIR) as CaseKernelIR
  validateCaseIR(frozenIR, registry)
  return Object.freeze({ caseIR: frozenIR, registry, dependencies })
}

export interface ResolvedCommandDecider {
  readonly capability: CapabilityDefinition
  readonly decide: CommandDecider
}

export function resolveCommandDecider(
  runtime: KernelRuntime,
  state: KernelState,
  commandType: string,
): ResolvedCommandDecider | undefined {
  const locks = state.status === 'empty' ? [KERNEL_CAPABILITY] : state.capabilityLocks
  for (const lock of locks) {
    const capability = resolveCapability(runtime.registry, lock)
    if (Object.prototype.hasOwnProperty.call(capability.commands, commandType)) {
      return { capability, decide: capability.commands[commandType] }
    }
  }
  return undefined
}
