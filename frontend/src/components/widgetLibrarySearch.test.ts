import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyWidgetLibraryKind,
  collectWidgetLibrarySearchText,
  formatWidgetLibrarySize,
  normalizeWidgetLibraryQuery,
  presentWidgetLibraryFilters,
  presentWidgetLibraryKindFilters,
  presentWidgetLibrarySizes,
  widgetLibrarySizes,
  widgetMatchesLibraryFilter,
  widgetMatchesLibraryKind,
  widgetMatchesLibrarySearch,
  widgetMatchesLibrarySize,
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

  it('uses supported sizes when present, else default', () => {
    assert.deepEqual(widgetLibrarySizes({ defaultSize: '2x2' }), ['2x2'])
    assert.deepEqual(
      widgetLibrarySizes({
        defaultSize: '2x2',
        supportedSizes: ['2x2', '4x2', '4x1'],
      }),
      ['2x2', '4x2', '4x1'],
    )
  })

  it('matches size filter against default or supported sizes', () => {
    assert.equal(widgetMatchesLibrarySize('all', { defaultSize: '4x2' }), true)
    assert.equal(widgetMatchesLibrarySize('4x2', { defaultSize: '4x2' }), true)
    assert.equal(widgetMatchesLibrarySize('1x1', { defaultSize: '4x2' }), false)
    assert.equal(
      widgetMatchesLibrarySize('4x2', {
        defaultSize: '2x2',
        supportedSizes: ['2x2', '4x2'],
      }),
      true,
    )
  })

  it('formats size labels with a multiplication sign', () => {
    assert.equal(formatWidgetLibrarySize('4x2'), '4×2')
    assert.equal(formatWidgetLibrarySize('1x1'), '1×1')
  })

  it('omits the size control when only one size is present', () => {
    assert.deepEqual(
      presentWidgetLibrarySizes([
        { defaultSize: '4x2' },
        { defaultSize: '4x2', supportedSizes: ['4x2'] },
      ]),
      [],
    )
  })

  it('lists present sizes in catalog order without flattening an All chip', () => {
    assert.deepEqual(
      presentWidgetLibrarySizes([
        { defaultSize: '4x2' },
        { defaultSize: '1x1', supportedSizes: ['1x1', '2x1', '2x2'] },
        { defaultSize: '2x2', supportedSizes: ['2x2', '4x2'] },
      ]),
      ['1x1', '2x1', '2x2', '4x2'],
    )
  })

  it('classifies builtin / report / tapp category', () => {
    assert.equal(classifyWidgetLibraryKind({ id: 'weather' }), 'builtin')
    assert.equal(classifyWidgetLibraryKind({ id: 'report-github' }), 'report')
    assert.equal(
      classifyWidgetLibraryKind({
        id: 'com.example.clock',
        isTappWidget: true,
        category: 'media',
      }),
      'tapp:media',
    )
    assert.equal(
      classifyWidgetLibraryKind({
        id: 'com.example.todo',
        isTappWidget: true,
      }),
      'tapp:utility',
    )
  })

  it('keeps all / builtin / report, then only Tapp categories that have widgets', () => {
    assert.deepEqual(
      presentWidgetLibraryKindFilters([
        { id: 'weather' },
        { id: 'report-github' },
        {
          id: 'com.example.clock',
          isTappWidget: true,
          category: 'media',
        },
        {
          id: 'com.example.notes',
          isTappWidget: true,
          category: 'productivity',
        },
      ]),
      ['all', 'builtin', 'report', 'tapp:media', 'tapp:productivity'],
    )
  })

  it('always keeps host chips even when a kind is empty', () => {
    assert.deepEqual(presentWidgetLibraryKindFilters([{ id: 'weather' }]), [
      'all',
      'builtin',
      'report',
    ])
  })

  it('matches kind filter', () => {
    assert.equal(widgetMatchesLibraryKind('all', { id: 'weather' }), true)
    assert.equal(widgetMatchesLibraryKind('builtin', { id: 'weather' }), true)
    assert.equal(
      widgetMatchesLibraryKind('report', { id: 'report-github' }),
      true,
    )
    assert.equal(
      widgetMatchesLibraryKind('tapp:media', {
        id: 'com.example.clock',
        isTappWidget: true,
        category: 'media',
      }),
      true,
    )
    assert.equal(
      widgetMatchesLibraryKind('tapp:media', { id: 'weather' }),
      false,
    )
  })

  it('unifies kind and size into one filter list', () => {
    assert.deepEqual(
      presentWidgetLibraryFilters([
        { id: 'weather', defaultSize: '2x2', supportedSizes: ['2x2', '4x2'] },
        { id: 'report-github', defaultSize: '4x2' },
        {
          id: 'com.example.clock',
          isTappWidget: true,
          category: 'media',
          defaultSize: '2x2',
        },
      ]),
      [
        'all',
        'builtin',
        'report',
        'tapp:media',
        'size:2x2',
        'size:4x2',
      ],
    )
  })

  it('matches the unified filter against kind or size', () => {
    const weather = {
      id: 'weather',
      defaultSize: '2x2',
      supportedSizes: ['2x2', '4x2'],
    }
    assert.equal(widgetMatchesLibraryFilter('all', weather), true)
    assert.equal(widgetMatchesLibraryFilter('builtin', weather), true)
    assert.equal(widgetMatchesLibraryFilter('report', weather), false)
    assert.equal(widgetMatchesLibraryFilter('size:4x2', weather), true)
    assert.equal(widgetMatchesLibraryFilter('size:1x1', weather), false)
  })
})
