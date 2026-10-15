import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const findMessageDefaults = {
  title: 'Find and replace',
  find: 'Find',
  replaceWith: 'Replace with',
  matchCase: 'Match case',
  wholeWord: 'Whole word',
  scope: 'Search in',
  scopePage: 'This page',
  scopeDocument: 'All pages',
  next: 'Next match',
  previous: 'Previous match',
  count: params('{current} of {total}'),
  noMatches: 'No matches',
  loading: 'Loading pages…',
  locked: 'Locked layers are found but not replaced.',
  replace: 'Replace',
  replaceAll: 'Replace all',
  replaced: params('Replaced: {count}')
} as const

export const findMessages = i18n('find', findMessageDefaults)
