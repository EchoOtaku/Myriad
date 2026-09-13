import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  clearNoteDraft,
  draftDiffersFrom,
  hardBreak,
  indentLines,
  linkAtCursor,
  NOTE_DRAFT_TTL_MS,
  noteDraftKey,
  openLineBelow,
  prefixLines,
  pruneOrphanFootnotes,
  readNoteDraft,
  replaceLink,
  setHeadingLevel,
  toggleWrap,
  wrapSelection,
  writeNoteDraft,
} from './noteDraft.ts'

/** node:test 没有 localStorage。 */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  return store
}

describe('草稿存取', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = installStorage()
  })

  it('写进去能读回来', () => {
    writeNoteDraft('new', { title: '标题', contentMd: '正文' }, 1000)
    assert.deepEqual(readNoteDraft('new', 1000), {
      title: '标题',
      contentMd: '正文',
      savedAt: 1000,
    })
  })

  it('旧草稿没有主题封面时间也能读，且不盖服务端值', () => {
    store.set(
      noteDraftKey('new'),
      JSON.stringify({ title: '标题', contentMd: '正文', savedAt: 1000 }),
    )
    const draft = readNoteDraft('new', 1000)
    assert.deepEqual(draft, {
      title: '标题',
      contentMd: '正文',
      savedAt: 1000,
    })
    assert.equal(
      draftDiffersFrom(draft, {
        title: '标题',
        contentMd: '正文',
        topic: 'ai',
        cover: 'https://img.example/a.jpg',
        publishedAt: 1,
      }),
      false,
    )
  })

  it('新草稿会记下主题封面和时间', () => {
    writeNoteDraft(
      'new',
      {
        title: '标题',
        contentMd: '正文',
        topic: 'ai',
        cover: 'https://img.example/a.jpg',
        publishedAt: 1_700_000_000_000,
      },
      1000,
    )
    assert.deepEqual(readNoteDraft('new', 1000), {
      title: '标题',
      contentMd: '正文',
      topic: 'ai',
      cover: 'https://img.example/a.jpg',
      publishedAt: 1_700_000_000_000,
      savedAt: 1000,
    })
  })

  it('新草稿和已发布的草稿互不覆盖', () => {
    writeNoteDraft('new', { title: '甲', contentMd: 'a' }, 1)
    writeNoteDraft(7, { title: '乙', contentMd: 'b' }, 1)
    assert.equal(readNoteDraft('new', 1)?.title, '甲')
    assert.equal(readNoteDraft(7, 1)?.title, '乙')
  })

  it('过期草稿不再恢复', () => {
    writeNoteDraft('new', { title: '标题', contentMd: '正文' }, 0)
    assert.notEqual(readNoteDraft('new', NOTE_DRAFT_TTL_MS), null)
    assert.equal(readNoteDraft('new', NOTE_DRAFT_TTL_MS + 1), null)
  })

  it('坏数据当没有草稿，不抛', () => {
    store.set(noteDraftKey('new'), '{ 不是 json')
    assert.equal(readNoteDraft('new'), null)
    store.set(noteDraftKey('new'), '{"title":"x"}')
    assert.equal(readNoteDraft('new'), null)
  })

  it('清掉之后读不到', () => {
    writeNoteDraft(3, { title: '标题', contentMd: '正文' }, 1)
    clearNoteDraft(3)
    assert.equal(readNoteDraft(3, 1), null)
  })

  it('localStorage 不可用时读写都不抛', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    assert.equal(readNoteDraft('new'), null)
    writeNoteDraft('new', { title: 'a', contentMd: 'b' })
    clearNoteDraft('new')
  })
})

describe('draftDiffersFrom', () => {
  it('内容相同就不算有改动', () => {
    const draft = { title: '标题', contentMd: '正文', savedAt: 1 }
    assert.equal(
      draftDiffersFrom(draft, { title: '标题', contentMd: '正文' }),
      false,
    )
  })

  it('只差首尾空白也不算改动', () => {
    const draft = { title: ' 标题 ', contentMd: '正文\n', savedAt: 1 }
    assert.equal(
      draftDiffersFrom(draft, { title: '标题', contentMd: '正文' }),
      false,
    )
  })

  it('正文变了就算改动', () => {
    const draft = {
      title: '标题',
      contentMd: '新正文',
      topic: null,
      cover: null,
      publishedAt: null,
      savedAt: 1,
    }
    assert.equal(
      draftDiffersFrom(draft, { title: '标题', contentMd: '正文' }),
      true,
    )
  })

  it('主题或封面变了也算改动', () => {
    const draft = {
      title: '标题',
      contentMd: '正文',
      topic: 'ai',
      cover: 'https://img.example/a.jpg',
      publishedAt: null,
      savedAt: 1,
    }
    assert.equal(
      draftDiffersFrom(draft, { title: '标题', contentMd: '正文' }),
      true,
    )
  })

  it('发布时间同一分钟不算改动', () => {
    const draft = {
      title: '标题',
      contentMd: '正文',
      topic: null,
      cover: null,
      publishedAt: 60_000,
      savedAt: 1,
    }
    assert.equal(
      draftDiffersFrom(draft, {
        title: '标题',
        contentMd: '正文',
        publishedAt: 90_000,
      }),
      false,
    )
    assert.equal(
      draftDiffersFrom(draft, {
        title: '标题',
        contentMd: '正文',
        publishedAt: 120_000,
      }),
      true,
    )
  })

  it('没有草稿就没有改动', () => {
    assert.equal(draftDiffersFrom(null, { title: 'a', contentMd: 'b' }), false)
  })
})

describe('wrapSelection', () => {
  it('包住选中的字，并保持选中', () => {
    const r = wrapSelection('这是正文', 2, 4, '**', '**')
    assert.equal(r.value, '这是**正文**')
    assert.equal(r.value.slice(r.selectionStart, r.selectionEnd), '正文')
  })

  it('没选区时插入占位符并选中它', () => {
    const r = wrapSelection('', 0, 0, '**', '**', '粗体')
    assert.equal(r.value, '**粗体**')
    assert.equal(r.value.slice(r.selectionStart, r.selectionEnd), '粗体')
  })

  it('没选区也没占位符时只插入标记', () => {
    const r = wrapSelection('ab', 1, 1, '`', '`')
    assert.equal(r.value, 'a``b')
    assert.equal(r.selectionStart, r.selectionEnd)
  })
})

describe('toggleWrap', () => {
  it('没包过就包上', () => {
    const r = toggleWrap('甲乙丙', 1, 2, '**', '**')
    assert.equal(r.value, '甲**乙**丙')
    assert.equal(r.selectionStart, 3)
    assert.equal(r.selectionEnd, 4)
  })

  it('选区外面已经有记号就拆掉', () => {
    const r = toggleWrap('甲**乙**丙', 3, 4, '**', '**')
    assert.equal(r.value, '甲乙丙')
    assert.deepEqual([r.selectionStart, r.selectionEnd], [1, 2])
  })

  it('选区连着记号一起选也拆掉', () => {
    const r = toggleWrap('甲**乙**丙', 1, 6, '**', '**')
    assert.equal(r.value, '甲乙丙')
    assert.deepEqual([r.selectionStart, r.selectionEnd], [1, 2])
  })

  it('没选区时插占位符', () => {
    const r = toggleWrap('甲', 1, 1, '`', '`', '代码')
    assert.equal(r.value, '甲`代码`')
  })
})

describe('linkAtCursor / replaceLink', () => {
  it('光标在链接里就找得到，图片不算', () => {
    const md = '看 [这里](https://a.b) 和 ![图](https://c.d)'
    const link = linkAtCursor(md, 5)
    assert.deepEqual(link, { start: 2, end: 19, text: '这里', url: 'https://a.b' })
    assert.equal(linkAtCursor(md, 25), null)
  })

  it('改地址或只留文字', () => {
    const md = '看 [这里](https://a.b)'
    const link = linkAtCursor(md, 4)!
    assert.equal(replaceLink(md, link, 'https://x.y').value, '看 [这里](https://x.y)')
    assert.equal(replaceLink(md, link, null).value, '看 这里')
  })
})

describe('openLineBelow', () => {
  it('行上有字就在行尾开新行，光标到新行', () => {
    assert.deepEqual(openLineBelow('甲乙\n丙', 1), { value: '甲乙\n\n丙', caret: 3 })
    assert.deepEqual(openLineBelow('甲乙', 2), { value: '甲乙\n', caret: 3 })
  })

  it('空行原地不动', () => {
    assert.deepEqual(openLineBelow('甲\n\n乙', 2), { value: '甲\n\n乙', caret: 2 })
    assert.deepEqual(openLineBelow('', 0), { value: '', caret: 0 })
  })
})

describe('hardBreak / pruneOrphanFootnotes', () => {
  it('硬换行是两个空格加换行', () => {
    const r = hardBreak('甲乙', 1, 1)
    assert.equal(r.value, '甲  \n乙')
    assert.equal(r.selectionStart, 4)
  })

  it('没有引用的脚注定义被删，有引用的留下', () => {
    const md = '正文[^1]\n\n[^1]: 一\n\n[^2]: 二\n'
    assert.equal(pruneOrphanFootnotes(md), '正文[^1]\n\n[^1]: 一')
  })
})

describe('setHeadingLevel', () => {
  it('普通行变成对应级别', () => {
    assert.equal(setHeadingLevel('节', 0, 0, 2).value, '## 节')
  })

  it('换级别不叠井号', () => {
    assert.equal(setHeadingLevel('## 节', 3, 3, 3).value, '### 节')
  })

  it('同级再点一次是去掉', () => {
    assert.equal(setHeadingLevel('### 节', 2, 2, 3).value, '节')
  })
})

describe('indentLines', () => {
  it('光标收拢：进两格，光标跟着走', () => {
    const r = indentLines('- 甲\n- 乙', 6, 6, false)
    assert.equal(r.value, '- 甲\n  - 乙')
    assert.equal(r.selectionStart, 8)
    assert.equal(r.selectionEnd, 8)
  })

  it('退格吃掉两格或一个制表符，退不动就不动', () => {
    assert.equal(indentLines('  - 甲', 4, 4, true).value, '- 甲')
    assert.equal(indentLines('\t- 甲', 2, 2, true).value, '- 甲')
    assert.equal(indentLines('- 甲', 1, 1, true).value, '- 甲')
  })

  it('多行选区每行都动，结果选中整块', () => {
    const r = indentLines('- 甲\n- 乙', 0, 7, false)
    assert.equal(r.value, '  - 甲\n  - 乙')
    assert.equal(r.selectionStart, 0)
    assert.equal(r.selectionEnd, r.value.length)
  })
})

describe('prefixLines', () => {
  it('给光标所在行加前缀', () => {
    const r = prefixLines('标题行', 1, 1, '## ')
    assert.equal(r.value, '## 标题行')
  })

  it('多行选区每一行都加', () => {
    const r = prefixLines('甲\n乙\n丙', 0, 5, '- ')
    assert.equal(r.value, '- 甲\n- 乙\n- 丙')
  })

  it('选区停在行边界上不带上下一行', () => {
    // 选到行边界为止，下一行不加前缀。
    assert.equal(prefixLines('甲\n乙\n丙', 0, 3, '- ').value, '- 甲\n- 乙\n丙')
    // 选区含行尾换行时，下一行仍不加前缀。
    assert.equal(prefixLines('甲\n乙\n丙', 0, 4, '- ').value, '- 甲\n- 乙\n丙')
  })

  it('已经全部有前缀时再点一次是去掉 —— 按钮可切换', () => {
    const r = prefixLines('- 甲\n- 乙', 0, 5, '- ')
    assert.equal(r.value, '甲\n乙')
  })

  it('只有部分行有前缀时补齐，不是去掉', () => {
    const r = prefixLines('- 甲\n乙', 0, 5, '- ')
    assert.equal(r.value, '- - 甲\n- 乙')
  })

  it('不动选区之外的行', () => {
    const r = prefixLines('头\n甲\n尾', 2, 3, '> ')
    assert.equal(r.value, '头\n> 甲\n尾')
  })
})
