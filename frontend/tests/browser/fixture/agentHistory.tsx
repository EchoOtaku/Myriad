import React, { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useConversationHistory } from '../../../src/components/agent-panel/conversationHistory'
import { AgentPresenceList } from '../../../src/components/agent-panel/useAgentPresence'
import { useConversationPan } from '../../../src/components/agent-panel/useConversationPan'

const ids = Array.from({ length: 80 }, (_, i) => String(i))

function History() {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const { visibleIds, onNearStart } = useConversationHistory(ids)
  useConversationPan(
    viewport,
    track,
    true,
    'history',
    '.agent-panel-message',
    onNearStart,
  )
  return (
    <div ref={viewport} style={{ height: 200, overflow: 'hidden' }}>
      <div ref={track} data-testid="track" style={{ position: 'relative' }}>
        <AgentPresenceList items={visibleIds} keyOf={(id) => id}>
          {(id) => (
            <div
              className="agent-panel-message"
              data-message-id={id}
              style={{ height: 100 }}
            >
              {id}
            </div>
          )}
        </AgentPresenceList>
      </div>
    </div>
  )
}

export function mountAgentHistory() {
  createRoot(document.getElementById('root')!).render(<History />)
}
