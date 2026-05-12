#!/usr/bin/env python3
"""
Local Whisper transcription script.
Usage: python3 transcribe.py <audio_file_path>
Prints the transcribed text to stdout.
"""
import sys
import os
import whisper

def main():
    if len(sys.argv) < 2:
        print("", flush=True)
        sys.exit(0)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print("", flush=True)
        sys.exit(0)

    # Use 'small' model — better accuracy, ~244MB download on first run
    model = whisper.load_model("small")
    result = model.transcribe(
        audio_path,
        fp16=False,
        language="en",
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
    )
    text = result.get("text", "").strip()
    print(text, flush=True)

if __name__ == "__main__":
    main()
