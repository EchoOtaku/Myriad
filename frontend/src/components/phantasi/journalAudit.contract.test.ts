import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '../../../..')
const read = (...parts: string[]) => readFileSync(join(dir, ...parts), 'utf8')
const readRoot = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8')

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, name)
  const rest = src.slice(start)
  const next = rest.slice(1).search(/\nexport (async )?function /)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

describe('手帐审计契约', () => {
  it('已读/收藏只清 stats，不重打源目录', () => {
    const api = read('../../services/phantasiApi.ts')
    for (const name of ['markRead', 'markUnread', 'starItem', 'unstarItem', 'markAllRead']) {
      const body = fnBody(api, name)
      assert.match(body, /invalidateStatsCache\(\)/)
      assert.doesNotMatch(body, /invalidateSourcesCache\(\)/)
    }
    const sources = read('usePhantasiSources.ts')
    assert.match(sources, /subscribeMutations/)
    assert.match(sources, /applyReadMutation/)
    assert.doesNotMatch(sources, /loadStats\(/)
  })

  it('批量刷新每源跳过缓存、结束只清一次', () => {
    const api = read('../../services/phantasiApi.ts')
    const body = fnBody(api, 'refreshSources')
    assert.match(body, /skipCache: true/)
    assert.equal(body.split('invalidateSourcesCache()').length - 1, 1)
    assert.equal(body.split('invalidateBoardPageCache()').length - 1, 1)
  })

  it('协同 WS 编辑帧不带正文，连接不跟正文重绑', () => {
    const collab = read('notes/useNoteCollab.ts')
    const send = collab.slice(collab.indexOf('type: \'edit\''))
    assert.match(collab, /liveRef/)
    assert.match(collab, /\}, \[cloudId, userName\]\)/)
    assert.doesNotMatch(collab, /COLLAB_BODY_FRAME_BYTES/)
    assert.doesNotMatch(send, /content_md/)
    assert.doesNotMatch(collab, /setInterval\([^)]{0,80}200\)/)
    assert.match(
      collab,
      /\}, \[cloudId, cover, loading, textareaRef, title, topic, userName\]\)/,
    )
  })

  it('阅读热路径按来源切会话，评论装饰活 DOM 补 mark', () => {
    const reader = read('PhantasiReader.tsx')
    const render = read('reader/contentRender.ts')
    const anchors = read('reader/commentAnchors.ts')
    const comments = read('reader/hooks/useComments.ts')
    assert.match(reader, /function ReaderNoteSession/)
    assert.match(reader, /function ReaderFeedSession/)
    assert.match(reader, /isNote \? <ReaderNoteSession/)
    assert.match(reader, /from ['"].*idleReaderTools['"]/)
    assert.match(render, /paintAnchoredComments\(/)
    assert.match(render, /paintAnchoredAnnotations\(/)
    assert.doesNotMatch(render, /highlightAnchoredComments/)
    assert.match(anchors, /export function paintAnchoredComments/)
    assert.match(anchors, /'highlights' in CSS/)
    assert.doesNotMatch(comments, /export function highlightComments/)
  })

  it('草稿列表走 pageData，墙用 excerpt 不带 content_md', () => {
    const pageData = read('pageData.ts')
    const notes = read('skin/PhantasiNotes.tsx')
    assert.match(pageData, /NOTE_DOCS_CACHE_KEY/)
    assert.match(pageData, /export async function loadNoteDocs/)
    assert.match(pageData, /phantasiApi\.listNoteDocs/)
    assert.match(notes, /doc\.excerpt/)
    assert.match(read('usePhantasiWorkbench.ts'), /loadNoteDocs/)
  })

  it('笔记墙用墙上邻居建队列，origin 是 notes', () => {
    const notes = read('skin/PhantasiNotes.tsx')
    const actions = read('usePhantasiItemActions.ts')
    assert.match(notes, /notesWallNeighbors/)
    assert.match(notes, /onOpenItem\(item, source, wallNeighbors\)/)
    assert.match(actions, /board === 'notes' \? 'notes' : 'feeds'/)
    assert.match(actions, /board === 'notes'\s*\?\s*neighbors/)
    assert.match(actions, /peekFeedStories\(/)
    assert.doesNotMatch(actions, /peekFeedStoriesLoose/)
    assert.match(actions, /last_success_at/)
    assert.doesNotMatch(actions, /last_fetched_at/)
    assert.match(notes, /onOpenItem\(latest, source, wallNeighbors\)/)
  })

  it('皮不自己 navigate，也不进口 phantasiApi / pageData', () => {
    const notes = read('skin/PhantasiNotes.tsx')
    const feeds = read('skin/PhantasiFeeds.tsx')
    const workbench = read('skin/PhantasiWorkbench.tsx')
    for (const src of [notes, feeds, workbench]) {
      assert.doesNotMatch(src, /useNavigate/)
      assert.doesNotMatch(src, /from ['"].*phantasiApi['"]/)
      assert.doesNotMatch(src, /from ['"].*pageData['"]/)
    }
    assert.match(notes, /onOpenItem/)
  })

  it('写评 UI 认 can_write，不把登录当成授予', () => {
    const comments = read('reader/hooks/useComments.ts')
    const reader = read('PhantasiReader.tsx')
    const api = read('../../services/phantasiApi.ts')
    assert.match(api, /can_write\?: boolean/)
    assert.match(comments, /setCanWrite\(Boolean\(response\.can_write\)\)/)
    assert.match(comments, /canWrite/)
    assert.match(reader, /showCommentPopup=\{showCommentPopup && commentsEnabled && canWrite\}/)
    assert.match(reader, /canReply=\{canWrite\}/)
  })

  it('发布/定时/取消定时前端带 revision', () => {
    const publish = read('notes/useNotePublish.ts')
    const api = read('../../services/phantasiApi.ts')
    assert.match(publish, /revision: revisionRef\.current/)
    assert.match(publish, /publishNoteDoc/)
    assert.match(publish, /scheduleNoteDoc/)
    assert.match(publish, /unscheduleNoteDoc\(cloudId, \{\s*revision:/)
    assert.match(fnBody(api, 'unscheduleNoteDoc'), /JSON\.stringify\(req\)/)
  })

  it('空草稿关闭会删云端稿', () => {
    const publish = read('notes/useNotePublish.ts')
    assert.match(publish, /docStatus === 'draft'/)
    assert.match(publish, /!title\.trim\(\)/)
    assert.match(publish, /!contentMd\.trim\(\)/)
    assert.match(publish, /deleteNoteDoc\(cloudId\)/)
    assert.match(publish, /labels\.deleteFailed/)
    assert.match(publish, /return/)
  })

  it('工作台搜索不读 content_md，列表封面走 image', () => {
    const workbench = read('logic/workbench.ts')
    const start = workbench.indexOf('function noteSearchHaystack')
    const joined = workbench.slice(workbench.indexOf('return [', start), start + 500)
    assert.doesNotMatch(joined, /doc\.content_md/)
    assert.match(joined, /doc\.excerpt/)
    assert.match(workbench, /workbenchNoteCover/)
  })

  it('Agent 打开和 TAPP 列表走 preview', () => {
    const agent = read('usePhantasiAgentOpen.ts')
    const tapp = read('../../tapp/runtime/sandbox/handlers/contentHandlers.ts')
    assert.match(agent, /getItemPreviews/)
    assert.doesNotMatch(agent, /getItems\(/)
    assert.match(tapp, /getItemPreviews/)
  })

  it('工作台批量删除列出失败项', () => {
    const workbench = read('usePhantasiWorkbench.ts')
    assert.match(workbench, /failed/)
    assert.match(workbench, /names/)
    assert.match(workbench, /#\$\{doc\.id\}/)
    assert.match(workbench, /return false/)
    const notes = read('skin/PhantasiWorkbenchNotes.tsx')
    assert.match(notes, /ok !== false/)
    const sources = read('usePhantasiSources.ts')
    assert.match(sources, /Promise\.allSettled/)
    assert.match(sources, /#\$\{id\}/)
  })

  it('新建分类失败不静默', () => {
    const format = read('notes/useNoteEditorFormat.ts')
    assert.match(format, /createCategory/)
    assert.match(format, /errorSaveFailed/)
    assert.match(format, /showNoteNotice\(\s*userFacingError\(err, t\.phantasi\.errorSaveFailed\)/)
    assert.doesNotMatch(format, /createCategory\(\{ name: next \}\)\.catch\(\(\) => \{\}\)/)
  })

  it('生产路径不打 console.log / console.debug', () => {
    const walk = (root: string): string[] =>
      readdirSync(root).flatMap((name) => {
        const next = join(root, name)
        if (statSync(next).isDirectory()) return walk(next)
        if (!/\.(ts|tsx)$/.test(name) || name.includes('.test.')) return []
        return [next]
      })
    const files = [
      ...walk(dir),
      join(dir, '../../services/phantasiApi.ts'),
      join(dir, '../../views/Phantasi.tsx'),
    ]
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /console\.log\(/, file)
      assert.doesNotMatch(src, /console\.debug\(/, file)
    }
  })

  it('升级说明给用户地址、不写 301，brew:write 标成历史', () => {
    const notes = readRoot('docs/development/UPGRADE_NOTES.md')
    assert.match(notes, /\/journal\/articles\/\{id\}/)
    assert.match(notes, /\/journal\/notes\.xml/)
    assert.match(notes, /\/phantasi\/articles\/\{id\}/)
    assert.match(notes, /无 301/)
    assert.match(notes, /历史权限名 `brew:write`/)
    assert.match(notes, /phantasi:write/)
    assert.doesNotMatch(notes, /仍然有效的 `ui:theme`、`media:control`、`brew:write`/)
    assert.doesNotMatch(notes, /Redirect 301/)
    const spa = readRoot('frontend/src/spaPaths.mjs')
    assert.doesNotMatch(spa, /status:\s*301/)
    assert.doesNotMatch(spa, /\/brew/)
    const routes = readRoot('backend/src/api/phantasi/routes.rs')
    assert.doesNotMatch(routes, /Redirect::/)
    assert.doesNotMatch(routes, /StatusCode::MOVED_PERMANENTLY/)
  })

  it('按轨/栏/读路径拆开', () => {
    const feeds = read('skin/PhantasiFeeds.tsx')
    const editor = read('notes/NoteEditor.tsx')
    const session = read('notes/useNoteEditorSession.ts')
    const preview = read('notes/useNoteEditorPreview.ts')
    const workbench = read('skin/PhantasiWorkbench.tsx')
    const routes = readRoot('backend/src/api/phantasi/routes.rs')
    assert.match(feeds, /from ['"].*PhantasiFeedsSites['"]/)
    assert.match(feeds, /from ['"].*PhantasiFeedsStories['"]/)
    assert.match(editor, /useNoteEditorSession/)
    assert.match(editor, /NoteEditorView/)
    assert.match(session, /useNoteEditorOpen/)
    assert.match(session, /useNoteCloudSave/)
    assert.match(session, /useNotePublish/)
    assert.match(session, /useNoteVisual/)
    assert.doesNotMatch(editor, /openNoteCloudDoc/)
    assert.doesNotMatch(session, /openNoteCloudDoc/)
    assert.match(workbench, /WorkbenchNotesPane/)
    assert.match(workbench, /from ['"].*PhantasiWorkbenchComments['"]/)
    assert.match(workbench, /from ['"].*PhantasiWorkbenchMedia['"]/)
    assert.match(workbench, /from ['"].*PhantasiWorkbenchIo['"]/)
    assert.match(workbench, /from ['"].*PhantasiWorkbenchFeeds['"]/)
    assert.match(session, /useNoteEditorAuthors/)
    assert.match(session, /useNoteEditorFormat/)
    assert.match(session, /useNoteEditorPreview/)
    assert.match(session, /useNoteEditorSidecar/)
    assert.match(preview, /noteEditorCaret/)
    assert.match(read('notes/useNoteEditorSidecar.ts'), /showNoteNotice/)
    assert.match(read('notes/useNoteEditorSidecar.ts'), /loadFailed/)
    assert.match(session, /errorLoadFailed/)
    assert.doesNotMatch(session, /\.catch\(\(\) => \{\}\)/)
    assert.match(read('manager/pipackIo.ts'), /showPhantasiError/)
    assert.match(
      read('manager/pipackIo.ts'),
      /实例失败不阻断源导入，但必须让人看见/,
    )
    assert.match(
      read('manager/pipackIo.ts'),
      /catch \(err\) \{\s*skipped\+\+\s*void showPhantasiError/,
    )
    assert.match(
      read('manager/contentIo/contentIo.ts'),
      /showPhantasiError/,
    )
    assert.match(
      read('manager/contentIo/contentIo.ts'),
      /skipped \+= 1\s*void showPhantasiError/,
    )
    assert.match(
      read('manager/RSSHubInstances.tsx'),
      /handleToggle[\s\S]*if \(!data\.success\) \{\s*showError\(data\.error \|\| phantasi\.errorSaveFailed\)/,
    )
    assert.match(
      read('manager/PhantasiWorkbenchAdmin.tsx'),
      /showPhantasiError\(err, phantasi\.errorSaveFailed\)/,
    )
    assert.doesNotMatch(
      read('manager/pipackIo.ts'),
      /catch \{\s*\/\/ 分类失败不阻断源导入\s*\}/,
    )
    assert.match(routes, /pub fn create_phantasi_routes/)
    assert.match(routes, /reading_item::get_item/)
    assert.match(routes, /feeds_list::/)
    assert.match(routes, /feeds_opml::/)
    assert.match(routes, /reading_mark::/)
    assert.match(routes, /reading_stats::/)
    assert.match(routes, /comments::list_comments/)
    assert.match(routes, /rsshub::list_rsshub_instances/)
    assert.match(
      readRoot('backend/src/api/phantasi/feeds_list.rs'),
      /pub\(crate\) async fn list_items/,
    )
    assert.match(
      readRoot('backend/src/api/phantasi/feeds_opml.rs'),
      /pub\(crate\) async fn export_opml/,
    )
    assert.match(
      readRoot('backend/src/api/phantasi/reading_mark.rs'),
      /pub\(crate\) async fn mark_all_read/,
    )
    assert.match(
      readRoot('backend/src/api/phantasi/reading_stats.rs'),
      /pub\(crate\) async fn get_stats/,
    )
    assert.match(
      readRoot('backend/src/api/phantasi/reading_item.rs'),
      /pub\(crate\) async fn get_item/,
    )
    assert.doesNotMatch(
      readRoot('backend/src/api/phantasi/reading_sync_ws.rs'),
      /pub\(crate\) async fn get_item/,
    )
  })
})
