import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveWorkbenchPane } from './board.ts'
import {
  collectWorkbenchMediaFormats,
  collectWorkbenchNoteTopics,
  filterWorkbenchMedia,
  filterWorkbenchNotes,
  formatWorkbenchBytes,
  workbenchMediaFormatKey,
  workbenchMediaFormatLabel,
  workbenchMediaRefLabel,
  workbenchNoteCover,
  workbenchNoteExcerpt,
  workbenchNoteOpen,
  workbenchNoteStatusKey,
  workbenchNoteWhen,
} from './workbench.ts'

describe('workbenchNoteOpen', () => {
  it('已发布走文章 id，草稿走文档 id', () => {
    assert.deepEqual(workbenchNoteOpen({ id: 3, item_id: 9 }), {
      kind: 'item',
      id: 9,
    })
    assert.deepEqual(workbenchNoteOpen({ id: 3, item_id: null }), {
      kind: 'doc',
      id: 3,
    })
  })
})

describe('workbenchNoteStatusKey', () => {
  it('只认定时和已发布，失败仍跟原状态', () => {
    assert.equal(
      workbenchNoteStatusKey({ status: 'scheduled' }),
      'noteStatusScheduled',
    )
    assert.equal(
      workbenchNoteStatusKey({ status: 'published' }),
      'noteStatusPublished',
    )
    assert.equal(workbenchNoteStatusKey({ status: 'draft' }), 'noteStatusDraft')
  })
})

describe('workbenchNoteWhen', () => {
  it('定时和失败用预约时间，已发布用发布时间', () => {
    assert.equal(
      workbenchNoteWhen({
        status: 'scheduled',
        scheduled_at: 20,
        updated_at: 10,
      }),
      20,
    )
    assert.equal(
      workbenchNoteWhen({
        status: 'draft',
        last_error: 'boom',
        scheduled_at: 20,
        updated_at: 10,
      }),
      20,
    )
    assert.equal(
      workbenchNoteWhen({
        status: 'published',
        published_at: 30,
        updated_at: 10,
      }),
      30,
    )
    assert.equal(workbenchNoteWhen({ status: 'draft', updated_at: 10 }), 10)
  })
})

describe('filterWorkbenchMedia', () => {
  const items = [
    {
      id: 1,
      kind: 'upload',
      mime: 'image/jpeg',
      name: 'cover.jpg',
    },
    {
      id: 2,
      kind: 'generated',
      mime: 'image/png',
      name: 'ai-sky.png',
    },
    {
      id: 3,
      kind: 'upload',
      mime: 'video/mp4',
      name: 'clip.mp4',
    },
  ]

  it('按来源、格式和文件名筛', () => {
    assert.deepEqual(
      filterWorkbenchMedia(items, { kind: 'all' }).map((item) => item.id),
      [1, 2, 3],
    )
    assert.deepEqual(
      filterWorkbenchMedia(items, { kind: 'upload' }).map((item) => item.id),
      [1, 3],
    )
    assert.deepEqual(
      filterWorkbenchMedia(items, { kind: 'generated' }).map((item) => item.id),
      [2],
    )
    assert.deepEqual(
      filterWorkbenchMedia(items, { kind: 'all', format: 'jpeg' }).map(
        (item) => item.id,
      ),
      [1],
    )
    assert.deepEqual(
      filterWorkbenchMedia(items, { kind: 'all', query: 'sky' }).map(
        (item) => item.id,
      ),
      [2],
    )
    assert.deepEqual(collectWorkbenchMediaFormats(items), [
      'jpeg',
      'png',
      'mp4',
    ])
    assert.equal(
      workbenchMediaFormatKey({
        mime: 'application/octet-stream',
        name: 'a.webp',
      }),
      'webp',
    )
    assert.equal(workbenchMediaFormatLabel('webp', '其他'), 'WebP')
    assert.equal(workbenchMediaFormatLabel('other', '其他'), '其他')
  })
})

describe('formatWorkbenchBytes / workbenchMediaRefLabel', () => {
  it('空尺寸不写，引用按已知种类翻译', () => {
    assert.equal(formatWorkbenchBytes(0), '')
    assert.equal(formatWorkbenchBytes(512), '512 B')
    assert.equal(formatWorkbenchBytes(2048), '2.0 KB')
    assert.equal(
      workbenchMediaRefLabel(['notes', 'site', 'other'], {
        notes: '手记',
        articles: '文章',
        site: '站点',
      }),
      '手记 · 站点',
    )
  })
})

describe('filterWorkbenchNotes', () => {
  const docs = [
    {
      id: 1,
      title: '春天的草稿',
      content_md: '樱花开了',
      topic: '生活',
      status: 'draft',
    },
    {
      id: 2,
      title: '夜里发',
      content_md: '定时稿',
      topic: '工作',
      status: 'scheduled',
    },
    {
      id: 3,
      title: '已见',
      content_md: '公开了',
      topic: null,
      status: 'published',
    },
    {
      id: 4,
      title: '失败的一篇',
      content_md: '没发出去',
      topic: '工作',
      status: 'scheduled',
      last_error: 'boom',
    },
  ]

  it('按状态、分类和标题正文搜', () => {
    assert.deepEqual(
      filterWorkbenchNotes(docs, { status: 'draft', query: '' }).map(
        (d) => d.id,
      ),
      [1],
    )
    assert.deepEqual(
      filterWorkbenchNotes(docs, { status: 'scheduled', query: '' }).map(
        (d) => d.id,
      ),
      [2, 4],
    )
    assert.deepEqual(
      filterWorkbenchNotes(docs, {
        status: 'all',
        query: '',
        topic: '工作',
      }).map((d) => d.id),
      [2, 4],
    )
    assert.deepEqual(
      filterWorkbenchNotes(docs, { status: 'all', query: '', topic: '' }).map(
        (d) => d.id,
      ),
      [3],
    )
    assert.deepEqual(
      filterWorkbenchNotes(docs, { status: 'all', query: '樱花' }).map(
        (d) => d.id,
      ),
      [1],
    )
    assert.deepEqual(collectWorkbenchNoteTopics(docs), ['工作', '生活'])
  })
})

describe('workbenchNoteCover', () => {
  it('指定封面优先，否则用正文第一张图', () => {
    assert.equal(
      workbenchNoteCover({
        image: 'https://img.example/cover.jpg',
        content_md: '![内文](https://img.example/body.jpg)\n开头',
      }),
      'https://img.example/cover.jpg',
    )
    assert.equal(
      workbenchNoteCover({
        image: '  ',
        content_md: '前文\n![内文](https://img.example/body.jpg)',
      }),
      'https://img.example/body.jpg',
    )
    assert.equal(
      workbenchNoteCover({ image: null, content_md: '没有图' }),
      null,
    )
    assert.equal(
      workbenchNoteCover({
        image: null,
        content_md: '![封面][cover]\n\n[cover]: https://img.example/ref.jpg',
      }),
      'https://img.example/ref.jpg',
    )
  })
})

describe('workbenchNoteExcerpt', () => {
  it('去掉标记，留下开头正文', () => {
    assert.equal(workbenchNoteExcerpt(''), '')
    assert.equal(
      workbenchNoteExcerpt(
        '![封面](https://img.example/a.jpg)\n# 标题\n这是**开头**，还有[链接](https://ex.am)。',
      ),
      '标题 这是开头，还有链接。',
    )
    assert.equal(
      workbenchNoteExcerpt(':::widget weather 2x2\n\n正文从这里起。'),
      '正文从这里起。',
    )
    assert.equal(workbenchNoteExcerpt('一二三四五', 3), '一二三…')
  })
})

describe('resolveWorkbenchPane', () => {
  it('认 home / notes / media / sources / add / rsshub / 两页导入导出；旧深链并进，其余落概览', () => {
    assert.equal(resolveWorkbenchPane('home'), 'home')
    assert.equal(resolveWorkbenchPane('media'), 'media')
    assert.equal(resolveWorkbenchPane('sources'), 'sources')
    assert.equal(resolveWorkbenchPane('add'), 'add')
    assert.equal(resolveWorkbenchPane('rsshub'), 'rsshub')
    assert.equal(resolveWorkbenchPane('notesIo'), 'notesIo')
    assert.equal(resolveWorkbenchPane('feedsIo'), 'feedsIo')
    assert.equal(resolveWorkbenchPane('brewpack'), 'feedsIo')
    assert.equal(resolveWorkbenchPane('opml'), 'feedsIo')
    assert.equal(resolveWorkbenchPane('wordpress'), 'notesIo')
    assert.equal(resolveWorkbenchPane('halo'), 'notesIo')
    assert.equal(resolveWorkbenchPane('typecho'), 'notesIo')
    assert.equal(resolveWorkbenchPane('markdown'), 'notesIo')
    assert.equal(resolveWorkbenchPane('list'), 'sources')
    assert.equal(resolveWorkbenchPane('notes'), 'notes')
    assert.equal(resolveWorkbenchPane(null), 'home')
    assert.equal(resolveWorkbenchPane('settings'), 'home')
  })
})
