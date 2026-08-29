import type { AgentFaceSink } from './agentFaceChannel'
import type {
  MeropeSpeechEventDetail,
  SpeechUtteranceInput,
} from './speechEvents'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentFaceChannel } from './agentFaceChannel'
import { readFileSync } from 'node:fs'
import {
  FaceSpeechGate,
  arbitrateFaceSpeech,
  cancelGatedSpeech,
  deliverGatedLine,
  deliverWorkNotificationFace,
  openGatedReply,
} from './faceSpeechArbitration'

class RecordingSink implements AgentFaceSink {
  readonly speechEvents: MeropeSpeechEventDetail[] = []
  readonly utterances: SpeechUtteranceInput[] = []
  readonly performances: unknown[] = []
  readonly states: unknown[] = []
  readonly order: string[] = []

  speech = (detail: MeropeSpeechEventDetail): void => {
    this.speechEvents.push(detail)
    this.order.push(`speech:${detail.phase}`)
  }

  utterance = (input: SpeechUtteranceInput): void => {
    this.utterances.push(input)
    this.order.push('utterance')
  }

  performance = (detail: unknown): void => {
    this.performances.push(detail)
    this.order.push('performance')
  }

  state = (detail: unknown): void => {
    this.states.push(detail)
    this.order.push('state')
  }
}

test('visible Chat speaks; background Work is recorded without speech', () => {
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'chat',
      incomingMode: 'chat',
      chatUtteranceActive: false,
    }),
    'speak',
  )
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'chat',
      incomingMode: 'work',
      chatUtteranceActive: false,
    }),
    'record-without-speech',
  )
})

test('an in-progress Chat utterance blocks Work speech even if Work is visible', () => {
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'work',
      incomingMode: 'work',
      chatUtteranceActive: true,
    }),
    'record-without-speech',
  )
  assert.equal(
    arbitrateFaceSpeech({
      visibleMode: 'work',
      incomingMode: 'work',
      chatUtteranceActive: false,
    }),
    'speak',
  )
})

test('Chat mid-utterance continues while a background Work completion is recorded, not spoken', () => {
  const sink = new RecordingSink()
  const channel = new AgentFaceChannel(sink)
  const gate = new FaceSpeechGate(() => 'chat')
  const recorded: FaceDeliveryRecord[] = []

  const chat = openGatedReply(channel, gate, 'chat', 'chat-msg', 'zh-CN')
  chat.chunk('我正在说')

  const work = deliverGatedLine(channel, gate, 'work', {
    messageId: 'work-msg',
    text: '报告已经写好了',
    locale: 'zh-CN',
  })
  recorded.push(work)

  chat.chunk('这句话')
  chat.end()

  assert.equal(work.surface, 'record')
  assert.equal(work.messageId, 'work-msg')
  assert.equal(work.text, '报告已经写好了')
  assert.deepEqual(
    recorded.map((item) => item.surface),
    ['record'],
  )

  assert.deepEqual(
    sink.speechEvents.map((event) => [event.phase, event.messageId, 'text' in event ? event.text : '']),
    [
      ['start', 'chat-msg', ''],
      ['chunk', 'chat-msg', '我正在说'],
      ['chunk', 'chat-msg', '这句话'],
      ['end', 'chat-msg', ''],
    ],
  )
  assert.equal(sink.utterances.length, 0)
  assert.equal(
    sink.speechEvents.some((event) => event.messageId === 'work-msg'),
    false,
  )
})

type FaceDeliveryRecord = {
  surface: 'speech' | 'record'
  messageId: string
  text?: string
}

test('notification-center Work completion is recorded, not spoken, while Chat is mid-utterance', () => {
  const sink = new RecordingSink()
  const channel = new AgentFaceChannel(sink)
  const gate = new FaceSpeechGate(() => 'chat')
  const chat = openGatedReply(channel, gate, 'chat', 'chat-msg')
  chat.chunk('还在说')

  const notice = deliverWorkNotificationFace(channel, gate, {
    id: 'notif-work-1',
    body: '任务完成了',
    performance: { phase: 'delivery', moodRevision: 3, plan: { cues: [] } },
    meropeState: { mood: 'calm', activity: 'idle' },
  })

  chat.chunk('完')
  chat.end()

  assert.equal(notice.surface, 'record')
  assert.equal(notice.messageId, 'notif-work-1')
  assert.equal(notice.text, '任务完成了')
  assert.deepEqual(sink.states, [{ mood: 'calm', activity: 'idle' }])
  assert.equal(sink.utterances.length, 0)
  assert.equal(sink.performances.length, 0)
  assert.equal(
    sink.speechEvents.some((event) => event.messageId === 'notif-work-1'),
    false,
  )
  assert.deepEqual(
    sink.speechEvents.map((event) => event.messageId),
    ['chat-msg', 'chat-msg', 'chat-msg', 'chat-msg'],
  )
})

test('Chat start then engine cancel releases occupancy so visible Work may speak', () => {
  const sink = new RecordingSink()
  const channel = new AgentFaceChannel(sink)
  let visible: 'work' | 'chat' = 'chat'
  const gate = new FaceSpeechGate(() => visible)
  const chat = openGatedReply(channel, gate, 'chat', 'chat-msg')
  chat.chunk('说到一半')
  // Engine cancel path — not the ReplyUtterance wrapper's cancel().
  cancelGatedSpeech(channel, gate, 'chat-msg')
  visible = 'work'

  const work = deliverGatedLine(channel, gate, 'work', {
    messageId: 'work-msg',
    text: '报告已经写好了',
  })
  assert.equal(work.surface, 'speech')
  assert.deepEqual(
    sink.utterances.map((item) => [item.messageId, item.text]),
    [['work-msg', '报告已经写好了']],
  )
})

test('notification center and engine cancel go through the gated Work/Chat helpers', () => {
  const panel = readFileSync(
    new URL('../../components/GlobalControlPanel.tsx', import.meta.url),
    'utf8',
  )
  const engine = readFileSync(
    new URL('../../components/agent-panel/AgentEngine.tsx', import.meta.url),
    'utf8',
  )
  assert.match(panel, /deliverWorkNotificationFace\(/)
  assert.doesNotMatch(panel, /agentFace\.deliver\(/)
  assert.match(engine, /cancelGatedSpeech\(/)
  assert.doesNotMatch(engine, /agentFace\.cancel\(/)
})

test('Work completion still speaks when Chat is not talking and Work is visible', () => {
  const sink = new RecordingSink()
  const channel = new AgentFaceChannel(sink)
  const gate = new FaceSpeechGate(() => 'work')

  const work = deliverGatedLine(channel, gate, 'work', {
    messageId: 'work-msg',
    text: '报告已经写好了',
  })

  assert.equal(work.surface, 'speech')
  assert.deepEqual(
    sink.utterances.map((item) => [item.messageId, item.text]),
    [['work-msg', '报告已经写好了']],
  )
})
