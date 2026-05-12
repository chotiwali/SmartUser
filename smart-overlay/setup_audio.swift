#!/usr/bin/swift
import CoreAudio
import Foundation

func getDeviceUID(_ deviceID: AudioDeviceID) -> String? {
    var uid = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    let err = withUnsafeMutablePointer(to: &uid) {
        AudioObjectGetPropertyData(deviceID, &addr, 0, nil, &size, $0)
    }
    return err == noErr ? uid as String : nil
}

func getDeviceName(_ deviceID: AudioDeviceID) -> String? {
    var name = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    let err = withUnsafeMutablePointer(to: &name) {
        AudioObjectGetPropertyData(deviceID, &addr, 0, nil, &size, $0)
    }
    return err == noErr ? name as String : nil
}

func hasOutputChannels(_ deviceID: AudioDeviceID) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration,
                                          mScope: kAudioDevicePropertyScopeOutput,
                                          mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(deviceID, &addr, 0, nil, &size) == noErr, size > 0 else { return false }
    let bufferCount = (size - UInt32(MemoryLayout<UInt32>.size)) / UInt32(MemoryLayout<AudioBuffer>.size)
    return bufferCount > 0
}

// Get all devices
var listAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                           mScope: kAudioObjectPropertyScopeGlobal,
                                           mElement: kAudioObjectPropertyElementMain)
var dataSize: UInt32 = 0
AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &dataSize)
let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
var ids = [AudioDeviceID](repeating: 0, count: count)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &dataSize, &ids)

var blackholeUID: String?
var speakersUID: String?
var speakersName: String?

for id in ids {
    guard let name = getDeviceName(id) else { continue }
    let lower = name.lowercased()
    if lower.contains("blackhole") {
        blackholeUID = getDeviceUID(id)
        print("Found BlackHole: \(name)")
    } else if hasOutputChannels(id) && (lower.contains("speaker") || lower.contains("macbook air") || lower.contains("macbook pro")) {
        if speakersUID == nil {
            speakersUID = getDeviceUID(id)
            speakersName = name
            print("Found Speakers: \(name)")
        }
    }
}

guard let bhUID = blackholeUID else {
    print("ERROR: BlackHole not found — install from https://existential.audio/blackhole/")
    exit(1)
}
guard let spUID = speakersUID else {
    print("ERROR: Speaker output device not found")
    exit(1)
}

// Build the Multi-Output (stacked) aggregate device descriptor
let desc: NSDictionary = [
    kAudioAggregateDeviceNameKey: "SmartOverlay Multi-Output",
    kAudioAggregateDeviceUIDKey: "com.smartoverlay.multioutput.v1",
    kAudioAggregateDeviceSubDeviceListKey: [
        [kAudioSubDeviceUIDKey: spUID],
        [kAudioSubDeviceUIDKey: bhUID],
    ],
    kAudioAggregateDeviceMasterSubDeviceKey: spUID,
    kAudioAggregateDeviceIsStackedKey: 1,  // 1 = Multi-Output, 0 = Aggregate
]

var newDeviceID: AudioDeviceID = 0
let createStatus = AudioHardwareCreateAggregateDevice(desc, &newDeviceID)

if createStatus != noErr {
    // -66748 (kAudioHardwareBadObjectError) can mean it already exists — that's fine
    if createStatus == -66748 || createStatus == kAudioHardwareIllegalOperationError {
        print("INFO: Device may already exist, continuing...")
    } else {
        print("ERROR: Failed to create Multi-Output Device (OSStatus: \(createStatus))")
        exit(1)
    }
}

// Set as default system output
var defaultAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal,
                                              mElement: kAudioObjectPropertyElementMain)
var dev = newDeviceID
let setStatus = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defaultAddr, 0, nil,
                                           UInt32(MemoryLayout<AudioDeviceID>.size), &dev)
if setStatus == noErr {
    print("SUCCESS: SmartOverlay Multi-Output set as default output")
    print("Zoom/browser audio will now play through speakers AND be captured by the app")
} else {
    print("WARNING: Device created but couldn't set as default (OSStatus: \(setStatus))")
    print("Go to System Settings > Sound > Output and select 'SmartOverlay Multi-Output'")
}
