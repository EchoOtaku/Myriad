import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { subscribeToast } from '../../utils/toastManager'
import { NOTE_TOAST_KEY, showNoteNotice } from './brewNotice'

describe('brew notice', () => {
  it('手记通知进 toast，同一槽替换不叠', () => {
    const seen: Array<{ message: string; type?: string; replaceKey?: string }> = []
    const stop = subscribeToast((event) => {
      seen.push({
        message: event.message,
        type: event.type,
        replaceKey: event.replaceKey,
      })
    })
    showNoteNotice(null)
    showNoteNotice('缺标题')
    showNoteNotice('保存失败')
    showNoteNotice('别人刚改过', 'warning')
    stop()
    assert.deepEqual(seen, [
      { message: '缺标题', type: 'error', replaceKey: NOTE_TOAST_KEY },
      { message: '保存失败', type: 'error', replaceKey: NOTE_TOAST_KEY },
      { message: '别人刚改过', type: 'warning', replaceKey: NOTE_TOAST_KEY },
    ])
  })
})
