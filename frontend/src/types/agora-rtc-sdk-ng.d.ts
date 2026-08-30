declare module 'agora-rtc-sdk-ng' {
  export type IAgoraRTCClient = {
    join: (
      appId: string,
      channel: string,
      token: string,
      uid: number | string,
    ) => Promise<number | string>
    publish: (tracks: unknown[]) => Promise<void>
    subscribe: (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => Promise<void>
    leave: () => Promise<void>
    on: (
      event: 'user-published' | 'user-unpublished',
      listener: (user: IAgoraRTCRemoteUser, mediaType?: 'audio' | 'video') => void,
    ) => void
  }
  export type IAgoraRTCRemoteUser = {
    uid: number | string
    audioTrack?: ILocalAudioTrack
  }
  export type ILocalAudioTrack = {
    play: () => void
    stop: () => void
    close: () => void
    getMediaStreamTrack: () => MediaStreamTrack
  }
  const AgoraRTC: {
    createClient: (config: { mode: string; codec: string }) => IAgoraRTCClient
    createMicrophoneAudioTrack: () => Promise<ILocalAudioTrack>
  }
  export default AgoraRTC
}
