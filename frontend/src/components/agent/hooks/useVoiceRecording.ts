/**
 * useVoiceRecording - 语音录制 hook
 *
 * 从 AraelPanel 提取的完整语音录制流程：
 * - 使用 Web Audio API 录制 PCM 音频
 * - 转换为 WAV 格式
 * - 调用 ASR 服务识别文字
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  audioToBase64,
  getSpeechStatus,
  speechToText,
} from '../../../services/speechApi'

interface RecorderState {
  audioContext: AudioContext
  stream: MediaStream
  processor: ScriptProcessorNode
  pcmData: Float32Array[]
}

const LOCALE_ENGINE_MAP: Record<string, string> = {
  'zh-CN': '16k_zh',
  'en-US': '16k_en',
  'ja-JP': '16k_ja',
}

export function useVoiceRecording(
  onResult: (text: string) => void,
  locale: string = 'zh-CN',
) {
  const [speechAvailable, setSpeechAvailable] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const recorderRef = useRef<RecorderState | null>(null)

  // 检测语音服务可用性
  useEffect(() => {
    getSpeechStatus()
      .then((s) => setSpeechAvailable(s.available && !!s.asr_enabled))
      .catch(() => {})
  }, [])

  const pcmToWav = useCallback(
    (pcmData: Float32Array[], sampleRate: number): Blob => {
      const totalLength = pcmData.reduce((acc, arr) => acc + arr.length, 0)
      const merged = new Float32Array(totalLength)
      let offset = 0
      for (const arr of pcmData) {
        merged.set(arr, offset)
        offset += arr.length
      }

      const buffer = new ArrayBuffer(44 + merged.length * 2)
      const view = new DataView(buffer)

      const writeString = (off: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(off + i, string.charCodeAt(i))
        }
      }

      writeString(0, 'RIFF')
      view.setUint32(4, 36 + merged.length * 2, true)
      writeString(8, 'WAVE')
      writeString(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeString(36, 'data')
      view.setUint32(40, merged.length * 2, true)

      const int16MinMagnitude = 32768
      const int16Max = 32767
      let dataOffset = 44
      for (let i = 0; i < merged.length; i++) {
        const sample = Math.max(-1, Math.min(1, merged[i]))
        view.setInt16(
          dataOffset,
          sample < 0 ? sample * int16MinMagnitude : sample * int16Max,
          true,
        )
        dataOffset += 2
      }

      return new Blob([buffer], { type: 'audio/wav' })
    },
    [],
  )

  const startRecording = useCallback(async () => {
    try {
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
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const pcmData: Float32Array[] = []

      processor.onaudioprocess = (e) => {
        pcmData.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      recorderRef.current = { audioContext, stream, processor, pcmData }
      setIsRecording(true)
    } catch (err) {
      console.error('[useVoiceRecording] 无法访问麦克风:', err)
    }
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || !isRecording) return

    setIsRecording(false)

    recorder.processor.disconnect()
    recorder.stream.getTracks().forEach((track) => track.stop())
    await recorder.audioContext.close()

    if (recorder.pcmData.length === 0) return

    setIsProcessingVoice(true)

    try {
      const wavBlob = pcmToWav(recorder.pcmData, 16000)
      const base64Audio = await audioToBase64(wavBlob)
      const result = await speechToText({
        audio_data: base64Audio,
        format: 'wav',
        engine: LOCALE_ENGINE_MAP[locale] || '16k_zh',
      })

      if (result.success && result.text) {
        onResult(result.text)
      }
    } catch (err) {
      console.error('[useVoiceRecording] 语音识别出错:', err)
    } finally {
      setIsProcessingVoice(false)
      recorderRef.current = null
    }
  }, [isRecording, pcmToWav, onResult])

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // 卸载时清理
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder) {
        recorder.processor?.disconnect()
        recorder.stream?.getTracks().forEach((track) => track.stop())
        recorder.audioContext?.close()
      }
    }
  }, [])

  return {
    speechAvailable,
    isRecording,
    isProcessingVoice,
    startRecording,
    stopRecording,
    toggleRecording,
  }
}
