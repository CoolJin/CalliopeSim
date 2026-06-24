class AudioService {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private isMuted: boolean = false;

  public init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.oscillator) {
      this.stopSound();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public playSound(frequency: number) {
    if (this.isMuted) return;
    this.init();
    
    if (this.oscillator) {
      this.oscillator.stop();
      this.oscillator.disconnect();
    }

    if (!this.audioContext) return;

    this.oscillator = this.audioContext.createOscillator();
    this.oscillator.type = 'square'; // Typical retro microbit sound
    this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    
    // Smooth gain to prevent popping
    const gainNode = this.audioContext.createGain();
    gainNode.gain.setValueAtTime(0.01, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.1, this.audioContext.currentTime + 0.05);

    this.oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    this.oscillator.start();
  }

  public stopSound() {
    if (this.oscillator && this.audioContext) {
      const gainNode = this.audioContext.createGain();
      this.oscillator.disconnect();
      this.oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.05);
      
      setTimeout(() => {
        if (this.oscillator) {
          this.oscillator.stop();
          this.oscillator.disconnect();
          this.oscillator = null;
        }
      }, 50);
    }
  }
}

export const audioService = new AudioService();
