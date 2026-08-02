import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectWidgetLibrarySearchText,
  normalizeWidgetLibraryQuery,
  widgetMatchesLibrarySearch,
  widgetTypeMatchesLibrarySearch,
} from './widgetLibrarySearch'

describe('widgetLibrarySearch', () => {
  it('normalizes query (trim + lower-case)', () => {
    assert.equal(normalizeWidgetLibraryQuery('  Weather  '), 'weather')
  })

  it('matches empty query against everything', () => {
    assert.equal(widgetMatchesLibrarySearch('', ['Welcome']), true)
    assert.equal(widgetMatchesLibrarySearch('   ', ['Welcome']), true)
  })

  it('matches runtime name/id without any preset map', () => {
    assert.equal(
      widgetTypeMatchesLibrarySearch('clock', {
        id: 'com.example.world-clock',
        name: 'World Clock',
      }),
      true,
    )
    assert.equal(
      widgetTypeMatchesLibrarySearch('world', {
        id: 'com.example.world-clock',
        name: 'World Clock',
      }),
      true,
    )
    assert.equal(
      widgetTypeMatchesLibrarySearch('example', {
        id: 'com.example.world-clock',
        name: 'World Clock',
      }),
      true,
    )
  })

  it('matches optional label and free-form extras (Tapp category / tappId)', () => {
    assert.equal(
      widgetTypeMatchesLibrarySearch('天气', {
        id: 'weather',
        name: 'Weather',
        label: '天气',
      }),
      true,
    )
    assert.equal(
      widgetTypeMatchesLibrarySearch('productivity', {
        id: 'todo.list',
        name: 'Todos',
        extras: ['productivity', 'tapp-my-todo'],
      }),
      true,
    )
    assert.equal(
      widgetTypeMatchesLibrarySearch('my-todo', {
        id: 'todo.list',
        name: 'Todos',
        extras: ['productivity', 'tapp-my-todo'],
      }),
      true,
    )
  })

  it('matches id with separators via spaced form', () => {
    const text = collectWidgetLibrarySearchText({
      id: 'music-player',
      name: 'Music',
    })
    assert.ok(text.includes('music-player'))
    assert.ok(text.includes('music player'))
    assert.equal(
      widgetTypeMatchesLibrarySearch('music player', {
        id: 'music-player',
        name: 'Music',
      }),
      true,
    )
  })

  it('rejects non-matching query', () => {
    assert.equal(
      widgetTypeMatchesLibrarySearch('github', {
        id: 'weather',
        name: 'Weather',
        label: '天气',
      }),
      false,
    )
  })

  it('ignores blank candidates', () => {
    assert.equal(widgetMatchesLibrarySearch('x', [null, undefined, '  ']), false)
    assert.equal(widgetMatchesLibrarySearch('x', [null, 'axb']), true)
  })
})
