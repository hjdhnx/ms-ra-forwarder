/**
 * TTS 类型定义。
 *
 * 独立服务包版（server/）：上游 service/tts-service.ts 的 zod schema 已剥离——
 * 服务端参数校验由 server.ts 手工完成（上游 route.ts 同款语义），运行时只消费
 * 类型。上游同步时注意保留此差异，其余以 `git diff service/tts-service.ts` 对照。
 */

export interface Voice {
    value: string
    label: string
    locale: string
    gender: string
    format: string
    /** 部分音色无 VoiceTag.VoicePersonalities，上游 fetchVoices 会给出 undefined。 */
    personalities?: string[]
}

export interface TTSOptions {
    voice: string
    /** -100..100 */
    volume: number
    /** -100..100 */
    rate: number
    /** -100..100 */
    pitch: number
    personality?: string
}

export interface SpeechBoundary {
    text: string
    start: number
    end: number
    duration: number
    length: string
}

export interface Speech {
    audio: ArrayBuffer
    sentenceBoundaries: SpeechBoundary[]
    wordBoundaries: SpeechBoundary[]
}

export interface TTSService {
    convert(text: string, options: TTSOptions): Promise<Speech>
    fetchVoices(): Promise<Array<Voice>>
}
