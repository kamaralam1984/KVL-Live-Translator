export interface MicDeviceInfo {
  deviceId: string;
  label: string;
  isDefault: boolean;
  /** True when the label looks like a PulseAudio/PipeWire monitor source
   * (Linux system-audio-via-input-device fallback, spec §20). */
  looksLikeSystemMonitor: boolean;
}

function looksLikeMonitorSource(label: string): boolean {
  return /monitor/i.test(label);
}

/**
 * Enumerates audio input devices and watches for add/remove/default-change.
 * Does not itself open any stream — that's MicrophoneCapture's job.
 */
export class AudioDeviceManager {
  private changeListeners = new Set<(devices: MicDeviceInfo[]) => void>();
  private boundHandler = () => this.notifyChange();

  async listMicrophones(): Promise<MicDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    return inputs.map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${index + 1}`,
      isDefault: d.deviceId === 'default',
      looksLikeSystemMonitor: looksLikeMonitorSource(d.label),
    }));
  }

  onChange(listener: (devices: MicDeviceInfo[]) => void): () => void {
    if (this.changeListeners.size === 0) {
      navigator.mediaDevices.addEventListener('devicechange', this.boundHandler);
    }
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
      if (this.changeListeners.size === 0) {
        navigator.mediaDevices.removeEventListener('devicechange', this.boundHandler);
      }
    };
  }

  private async notifyChange(): Promise<void> {
    const devices = await this.listMicrophones();
    for (const listener of this.changeListeners) listener(devices);
  }
}
