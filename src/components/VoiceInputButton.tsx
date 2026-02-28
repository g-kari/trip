import { useState, useCallback, useEffect, useRef } from 'react'
import { MicIcon } from './Icons'

// Type definitions for Web Speech API (not available in standard TypeScript)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognition
}

// Declare the global window properties for Speech Recognition
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

type VoiceInputButtonProps = {
  onResult: (transcript: string) => void
  onError?: (error: string) => void
  disabled?: boolean
  className?: string
}

// Check if Speech Recognition API is available
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function VoiceInputButton({
  onResult,
  onError,
  disabled = false,
  className = '',
}: VoiceInputButtonProps) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(() => getSpeechRecognition() !== null)
  const onResultRef = useRef(onResult)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => { onResultRef.current = onResult }, [onResult])

  // Initialize speech recognition on mount
  useEffect(() => {
    const SpeechRecognitionAPI = getSpeechRecognition()
    if (!SpeechRecognitionAPI) {
      setIsSupported(false)
      return
    }

    const recognitionInstance = new SpeechRecognitionAPI()
    recognitionInstance.continuous = false
    recognitionInstance.interimResults = false
    recognitionInstance.lang = 'ja-JP'
    recognitionInstance.maxAlternatives = 1

    recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex]
      if (result && result.isFinal) {
        const transcript = result[0].transcript
        onResultRef.current(transcript)
      }
    }

    recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error)
      setIsListening(false)

      let errorMessage = '音声認識でエラーが発生しました'
      switch (event.error) {
        case 'no-speech':
          errorMessage = '音声が検出されませんでした'
          break
        case 'audio-capture':
          errorMessage = 'マイクが見つかりません'
          break
        case 'not-allowed':
          errorMessage = 'マイクへのアクセスが許可されていません'
          break
        case 'network':
          errorMessage = 'ネットワークエラーが発生しました'
          break
        case 'aborted':
          // User aborted, no error message needed
          return
      }
      onError?.(errorMessage)
    }

    recognitionInstance.onend = () => {
      setIsListening(false)
    }

    recognitionInstance.onstart = () => {
      setIsListening(true)
    }

    recognitionRef.current = recognitionInstance

    return () => {
      recognitionRef.current?.abort()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return

    if (isListening) {
      recognitionRef.current.stop()
    } else {
      try {
        recognitionRef.current.start()
      } catch (err) {
        console.error('Failed to start speech recognition:', err)
        onError?.('音声認識を開始できませんでした')
      }
    }
  }, [isListening, onError])

  // Don't render if not supported
  if (!isSupported) {
    return null
  }

  return (
    <button
      type="button"
      className={`voice-input-btn ${isListening ? 'voice-input-btn--listening' : ''} ${className}`}
      onClick={toggleListening}
      disabled={disabled}
      title={isListening ? '音声入力を停止' : '音声で入力'}
      aria-label={isListening ? '音声入力を停止' : '音声で入力'}
    >
      <MicIcon size={18} />
      {isListening && <span className="voice-input-pulse" />}
    </button>
  )
}
