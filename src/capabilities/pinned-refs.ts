import type { CapabilityRef } from '../kernel/types'

/**
 * Browser-safe capability locks for the trusted runtime implementations.
 *
 * The authoring catalog derives these digests from its semantic manifests in
 * Node.js. Runtime code intentionally consumes only this pinned table so it
 * does not need a hashing implementation merely to validate an already
 * compiled case. `pinned-refs.test.ts` prevents this table and the authoring
 * catalog from drifting apart.
 */
export type TrustedCapabilitySpecifier = `${string}@${number}`

function pinned(
  id: string,
  digest: string,
): Readonly<CapabilityRef> {
  return Object.freeze({ id, version: '1', digest })
}

export const PINNED_CAPABILITY_REFS = Object.freeze({
  'access-control@1': pinned(
    'access-control',
    'd18793ccc561f7ec02b9ca2e44d8e467a52c8168720e08c0eea0f479942b3f11',
  ),
  'artifacts@1': pinned(
    'artifacts',
    'bfffee442e42684e5990897197611f0e07e9a6efacc81f7626d8787e2fd20939',
  ),
  'casebook@1': pinned(
    'casebook',
    'c29e1d14692438d5d2b209937716a900950dde9a1e786d4510c31e5663195841',
  ),
  'comms@1': pinned(
    'comms',
    '3c286d885b433c566494e53db06cba1e5dda3335b7018d8143140991cfa72f97',
  ),
  'contact-directory@1': pinned(
    'contact-directory',
    '63c17c0cae6e1f5a8d8bb28e9e70f5520f8d3e32f809f2eec98bdeeee3f703ed',
  ),
  'facility-logistics@1': pinned(
    'facility-logistics',
    'e1e6deb974fccec26a90f00bfda81ecac211c4af9292ef80e4cd5a4302b608f2',
  ),
  'finance@1': pinned(
    'finance',
    'a692ac2be39c63b6fcb4a22bfd2a61d6887433124493b0397605bcb336b9f4eb',
  ),
  'generic-actions@1': pinned(
    'generic-actions',
    'a99e5b5d413f86fb31f0ae40280f4faff37a227ce3ef35048aea606ade84c188',
  ),
  'interview@1': pinned(
    'interview',
    'dcf9a64379e1e6fceeb1be8c3aca94c7ed81342b45dd0ca30492c46a9f7269d9',
  ),
  'investigation@1': pinned(
    'investigation',
    '1869fc59a37c0b6b7becdaa99ce468740c4410b4bbd69e952c8d04d2125cbc58',
  ),
  'media-forensics@1': pinned(
    'media-forensics',
    '2474e66188da9b550073f3492a60bc952fc3809dc161def1964a142520efa79d',
  ),
  'stage-automation@1': pinned(
    'stage-automation',
    'e976487e91860c058330369e6dd123bdd06ad697635529e7397266a02eb174c3',
  ),
  'virtual-web@1': pinned(
    'virtual-web',
    '7991778409bfefd82caa9659c414a9d2f50135f9874babeecbf0928589fcfc6d',
  ),
} satisfies Readonly<Record<TrustedCapabilitySpecifier, Readonly<CapabilityRef>>>)
