/**
 * 说给它听。
 *
 * Push-to-talk still records a whole clip then ASR.
 * Continuous listen is off until the person turns it on: local VAD stops TTS
 * immediately, then a paused clip is transcribed. Partial text is UI-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  frameRms,
  isSubmittableTranscript,
  pcmToWav,
} from '../../features/merope/speech/audioWav'
import { getSpeechPipeline } from '../../features/merope/speech/speechPipelineHost'
import {
  getVoicePresence,
  patchVoicePresence,
} from '../../features/merope/speech/voicePresence'
import { dropPendingTurnTrace, stampTurnTrace } from '../../features/merope/turnTrace'
import {
  audioToBase64,
  getSpeechStatus,
  speechToText,
} from '../../services/speechApi'
import {
  getListenConsent,
  setListenConsent,
  subscribeListenConsent,
} from './listenConsent'

interface RecorderState {
  audioContext: AudioContext
  stream: MediaStream
  workletNode: AudioWorkletNode
  muteNode: GainNode
  pcmData: Float32Array[]
}

const LOCALE_ENGINE_MAP: Record<string, string> = {
  'zh-CN': '16k_zh',
  'en-US': '16k_en',
  'ja-JP': '16k_ja',
}

const WORKLET_PROCESSOR_NAME = 'pcm-capture-processor'
const OPEN_THRESHOLD = 0.035
const TTS_OPEN_THRESHOLD = 0.14
const CLOSE_RATIO = 0.45
const START_FRAMES = 4
const END_FRAMES = 18
/** Continuous listen must not keep an unbounded PCM tape. */
const MAX_LISTEN_SAMPLES = 16_000 * 20

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length > 0) {
      const copy = new Float32Array(channel.length)
      copy.set(channel)
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}
registerProcessor('${WORKLET_PROCESSOR_NAME}', PcmCaptureProcessor)
`

async function createPcmCaptureNode(
  audioContext: AudioContext,
): Promise<AudioWorkletNode> {
  if (!audioContext.audioWorklet) {
    throw new Error('AudioWorklet is not supported in this browser')
  }
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await audioContext.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  return new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME)
}

function cleanupRecorder(recorder: RecorderState) {
  try {
    recorder.workletNode.port.onmessage = null
    recorder.workletNode.disconnect()
  } catch {
    // already disconnected
  }
  try {
    recorder.muteNode.disconnect()
  } catch {
    // already disconnected
  }
  recorder.stream.getTracks().forEach((track) => track.stop())
  void recorder.audioContext.close()
}

export function useVoiceRecording(
  onResult: (text: string) => void,
  locale: string = 'zh-CN',
) {
  const [speechAvailable, setSpeechAvailable] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const [listening, setListening] = useState(getListenConsent)
  const recorderRef = useRef<RecorderState | null>(null)
  const isRecordingRef = useRef(false)
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const speakingRef = useRef(false)
  const openFramesRef = useRef(0)
  const closeFramesRef = useRef(0)
  const utterancePcmRef = useRef<Float32Array[]>([])
  const utteranceSamplesRef = useRef(0)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const localeRef = useRef(locale)
  localeRef.current = locale

  useEffect(() => {
    getSpeechStatus()
      .then((s) => setSpeechAvailable(s.available && !!s.asr_enabled))
      .catch(() => {})
  }, [])

  useEffect(() => subscribeListenConsent(() => setListening(getListenConsent())), [])

  const transcribe = useCallback(async (pcmData: Float32Array[], sampleRate: number) => {
    if (pcmData.length === 0) {
      dropPendingTurnTrace()
      return
    }
    setIsProcessingVoice(true)
    try {
      const wavBlob = pcmToWav(pcmData, sampleRate)
      const base64Audio = await audioToBase64(wavBlob)
      const result = await speechToText({
        audio_data: base64Audio,
        format: 'wav',
        engine: LOCALE_ENGINE_MAP[localeRef.current] || '16k_zh',
      })
      const text = result.success ? result.text?.trim() ?? '' : ''
      stampTurnTrace('input_final')
      if (isSubmittableTranscript(text)) onResultRef.current(text)
      else dropPendingTurnTrace()
      patchVoicePresence({ partial: '' })
    } catch (err) {
      console.error('[useVoiceRecording] 语音识别出错:', err)
      dropPendingTurnTrace()
    } finally {
      setIsProcessingVoice(false)
    }
  }, [])

  const flushListenClip = useCallback(
    (recorder: RecorderState) => {
      const clip = utterancePcmRef.current
      utterancePcmRef.current = []
      utteranceSamplesRef.current = 0
      speakingRef.current = false
      closeFramesRef.current = 0
      patchVoicePresence({ userSpeaking: false })
      if (clip.length === 0) return
      const sampleRate = recorder.audioContext.sampleRate || 16000
      void transcribe(clip, sampleRate)
    },
    [transcribe],
  )

  const onPcm = useCallback((frame: Float32Array) => {
    const recorder = recorderRef.current
    if (!recorder || !isRecordingRef.current) return
    if (!listeningRef.current) {
      recorder.pcmData.push(frame)
      return
    }

    const rms = frameRms(frame)
    const open =
      getVoicePresence().ttsPlaying ? TTS_OPEN_THRESHOLD : OPEN_THRESHOLD
    const close = open * CLOSE_RATIO
    if (!speakingRef.current) {
      if (rms >= open) {
        openFramesRef.current += 1
        if (openFramesRef.current >= START_FRAMES) {
          speakingRef.current = true
          openFramesRef.current = 0
          closeFramesRef.current = 0
          utterancePcmRef.current = [frame]
          utteranceSamplesRef.current = frame.length
          patchVoicePresence({ userSpeaking: true, partial: '' })
          stampTurnTrace('input_started')
          getSpeechPipeline().cancel()
        }
      } else {
        openFramesRef.current = 0
      }
      return
    }
    utterancePcmRef.current.push(frame)
    utteranceSamplesRef.current += frame.length
    if (rms < close) closeFramesRef.current += 1
    else closeFramesRef.current = 0
    if (
      utteranceSamplesRef.current >= MAX_LISTEN_SAMPLES ||
      closeFramesRef.current >= END_FRAMES
    ) {
      flushListenClip(recorder)
    }
  }, [flushListenClip])

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || recorderRef.current) return

    try {
      void import('../../utils/analyticsEvents').then(
        ({ trackProductEvent, AnalyticsEvents }) => {
          trackProductEvent(AnalyticsEvents.AGENT_VOICE, { throttleMs: 5000 })
        },
      )
      const status = await getSpeechStatus()
      if (!status.available || !status.asr_enabled) return

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      const audioContext = new AudioContext({ sampleRate: 16000 })
      const pcmData: Float32Array[] = []

      let workletNode: AudioWorkletNode
      try {
        workletNode = await createPcmCaptureNode(audioContext)
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop())
        await audioContext.close()
        throw err
      }

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        onPcm(event.data)
      }

      const muteNode = audioContext.createGain()
      muteNode.gain.value = 0
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)
      workletNode.connect(muteNode)
      muteNode.connect(audioContext.destination)
      if (audioContext.state === 'suspended') await audioContext.resume()

      recorderRef.current = {
        audioContext,
        stream,
        workletNode,
        muteNode,
        pcmData,
      }
      isRecordingRef.current = true
      setIsRecording(true)
      stampTurnTrace('input_started')
      patchVoicePresence({ listening: listeningRef.current })
    } catch (err) {
      console.error('[useVoiceRecording] 无法访问麦克风:', err)
    }
  }, [onPcm])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || !isRecordingRef.current) return

    isRecordingRef.current = false
    setIsRecording(false)
    speakingRef.current = false
    patchVoicePresence({
      listening: false,
      userSpeaking: false,
      partial: '',
    })

    const sampleRate = recorder.audioContext.sampleRate || 16000
    const pcmData = listeningRef.current
      ? utterancePcmRef.current
      : recorder.pcmData
    utterancePcmRef.current = []
    utteranceSamplesRef.current = 0
    cleanupRecorder(recorder)
    recorderRef.current = null
    await transcribe(pcmData, sampleRate)
  }, [transcribe])

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) void stopRecording()
    else void startRecording()
  }, [startRecording, stopRecording])

  const toggleListen = useCallback(() => {
    const next = !getListenConsent()
    setListenConsent(next)
    setListening(next)
    patchVoicePresence({ listening: next && isRecordingRef.current })
  }, [])

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder) {
        isRecordingRef.current = false
        cleanupRecorder(recorder)
        recorderRef.current = null
      }
      dropPendingTurnTrace()
      patchVoicePresence({
        listening: false,
        userSpeaking: false,
        partial: '',
      })
    }
  }, [])

  return {
    speechAvailable,
    isRecording,
    isProcessingVoice,
    listening,
    startRecording,
    stopRecording,
    toggleRecording,
    toggleListen,
  }
}
