import type { MessageBodyRef } from '../../../src/components/agent-panel/messageBody'
import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentMessageBody } from '../../../src/components/agent-panel/AgentMessageBody'
import { BodyWriter, prepareMessageBody, readBodyPage, readCompleteBody, releaseMessageBody } from '../../../src/components/agent-panel/messageBody'
import { prepareChatBody } from '../../../src/components/agent-panel/prepareChatBody'
import { useMessageState } from '../../../src/components/agent-panel/useMessageState'
import { I18nProvider } from '../../../src/contexts/I18nContext'
import { authSubject } from '../../../src/utils/authSubject'

function App() {
  const state = useMessageState('work')
  const [body, setBody] = useState<{ content: string; body?: MessageBodyRef } | null>(null)
  Object.assign(window, { agentBody: {
    async normalized() {
      const content = `<think>${'private'.repeat(3000)}</think>${'visible'.repeat(3000)}[[wear:stage]]`
      const message = await prepareChatBody({ id: 'history', sessionId: 's', role: 'assistant', content, createdAt: new Date() }, authSubject.signal)
      const reply = await readCompleteBody(message.content, message.body)
      const thought = await readCompleteBody(message.taskExecution!.reasoning!, message.taskExecution!.reasoningBody)
      for (const body of [message.body, message.taskExecution?.reasoningBody]) { if (body) await releaseMessageBody(body)
}
      state.setMessages([{ id: 'final', sessionId: 's', role: 'assistant', content: '', createdAt: new Date() }])
      await new Promise(resolve => setTimeout(resolve, 0))
      await state.updateMessage('final', { content })
      return { reply, thought }
    },
    async stream() {
      const writer = new BodyWriter(crypto.randomUUID(), authSubject.signal)
      for (let i = 0; i < 128; i++) await writer.append(String.fromCharCode(65 + i % 26).repeat(65536))
      const result = writer.snapshot()
      writer.finish()
      setBody(result)
      return { retained: writer.retainedChars, chars: result.body?.chars }
    },
    async snapshot() {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('myriad-agent-bodies-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const tx = db.transaction(['pages', 'stats', 'bodies'])
      const value = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const [pages, bytes, bodies] = await Promise.all([value(tx.objectStore('pages').getAll()), value(tx.objectStore('stats').get('bytes')), value(tx.objectStore('bodies').count())])
      db.close()
      return { count: pages.length, largest: Math.max(0, ...pages.map(page => page.length)), bytes, bodies }
    },
    async complete() { return (await readCompleteBody(body!.content, body!.body)).length },
    async release() { await releaseMessageBody(body!.body!); setBody(null) },
    async oldRead() { return readBodyPage(body!.body!, 0).then(() => 'read', () => 'denied') },
    changeIdentity() { authSubject.change('other-user', true) },
    async race() {
      state.setMessages([{ id: 'race', role: 'assistant', sessionId: 's', content: '', createdAt: new Date() }])
      await new Promise(resolve => setTimeout(resolve, 0))
      const stale = state.updateMessage('race', { content: 'x'.repeat(2 * 1024 * 1024) })
      await state.updateMessage('race', { content: 'newest' })
      await stale
    },
    async evict() {
      state.setMessages([{ id: 'evict', role: 'assistant', sessionId: 's', content: '', createdAt: new Date() }])
      await new Promise(resolve => setTimeout(resolve, 0))
      const stale = state.updateMessage('evict', { content: 'x'.repeat(65536) })
      state.setMessages([])
      await stale
    },
    async cancelled() {
      const controller = new AbortController()
      const pending = prepareMessageBody('x'.repeat(2 * 1024 * 1024), controller.signal)
      controller.abort()
      return pending.then(() => 'unexpected', () => 'cancelled')
    },
  } })
  return <><div id="message-state">{state.messages[0]?.content}</div>{body?.body && <AgentMessageBody body={body.body} preview={body.content} />}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider><App /></I18nProvider></StrictMode>)
